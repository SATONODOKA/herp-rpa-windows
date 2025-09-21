const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { SimplePDFExtractor } = require('./src/extractors/simple-pdf-extractor');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// multer設定（JSONとPDFファイル用）
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.fieldname === 'jsonFile') {
            cb(null, 'input/ready/');
        } else if (file.fieldname === 'pdfFile') {
            cb(null, 'input/ready/');
        } else {
            cb(null, 'input/ready/');
        }
    },
    filename: function (req, file, cb) {
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        cb(null, `${timestamp}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        console.log(`📁 ファイル受信: fieldname=${file.fieldname}, mimetype=${file.mimetype}, originalname=${file.originalname}`);
        
        if (file.fieldname === 'jsonFile') {
            // JSONファイルは拡張子やMIMEタイプで判定
            if (file.mimetype === 'application/json' || 
                file.originalname.endsWith('.json') ||
                file.mimetype === 'application/octet-stream') { // Blobの場合
                cb(null, true);
            } else {
                console.log(`❌ JSONファイルの形式エラー: ${file.mimetype}`);
                cb(new Error('JSONファイルが必要です'), false);
            }
        } else if (file.fieldname === 'pdfFile') {
            // PDFファイルは拡張子やMIMEタイプで判定
            if (file.mimetype === 'application/pdf' || 
                file.originalname.endsWith('.pdf')) {
                cb(null, true);
            } else {
                console.log(`❌ PDFファイルの形式エラー: ${file.mimetype}`);
                cb(new Error('PDFファイルが必要です'), false);
            }
        } else {
            console.log(`❌ 不正なフィールド名: ${file.fieldname}`);
            cb(new Error(`不正なフィールド名: ${file.fieldname}`), false);
        }
    }
});

let browser = null;
let page = null;
let sseClients = [];

// 安全性設定
const SAFETY_CONFIG = {
    MINIMUM_CONFIDENCE_THRESHOLD: 90,
    ENABLE_STRICT_MODE: true,
    LOG_ALL_EXTRACTIONS: true,
    MAX_RETRY_ATTEMPTS: 3,
    PAGE_TIMEOUT: 30000,
    ELEMENT_WAIT_TIMEOUT: 5000,
    FILE_SIZE_LIMIT: 10 * 1024 * 1024 // 10MB
};

// エラータイプの定義
const ERROR_TYPES = {
    INVALID_FORMAT: "入力形式エラー",
    EXTRACTION_FAILED: "抽出失敗",
    AMBIGUOUS_MATCH: "曖昧なマッチング",
    LOW_CONFIDENCE: "信頼度不足",
    SAFETY_CHECK_FAILED: "安全性チェック失敗"
};

class JobMatchingError extends Error {
    constructor(message, type, details) {
        super(message);
        this.type = type;
        this.details = details;
        this.timestamp = new Date();
    }
}

// 新しいJSON書式から求人名を安全に抽出
function extractJobNameFromComplexFormat(data) {
    const extractionResult = {
        success: false,
        extractedName: null,
        confidence: 0,
        method: null,
        warnings: [],
        errors: [],
        originalData: null,
        additionalRequiredFields: [], // 追加必須項目
        raCommentFields: [] // RAコメントから検出された項目
    };

    try {
        // 1. 従来の単純な形式をチェック
        if (data.name && typeof data.name === 'string') {
            extractionResult.success = true;
            extractionResult.extractedName = data.name.trim();
            extractionResult.confidence = 100;
            extractionResult.method = 'simple_name_field';
            extractionResult.originalData = data.name;
            return extractionResult;
        }

        // 2. 新しい複雑な形式をチェック
        if (data.calib && data.calib.record && data.calib.record.ra_memo_raw) {
            const raMemoRaw = data.calib.record.ra_memo_raw;
            extractionResult.originalData = raMemoRaw;
            
            // 追加必須項目を抽出（既存機能に追加）
            if (data.kintone && data.kintone.record) {
                const atsInputType = data.kintone.record.ats_input_type_1_raw;
                const additionalFields = data.kintone.record.additional_required_fields_raw;
                const autoConsentFields = data.kintone.record.auto_consent_fields_raw;
                
                if (atsInputType && atsInputType.includes('追加指定項目あり') && additionalFields) {
                    extractionResult.additionalRequiredFields = Array.isArray(additionalFields) ? additionalFields : [];
                    if (extractionResult.additionalRequiredFields.length > 0) {
                        extractionResult.warnings.push(`追加必須項目が指定されています: ${extractionResult.additionalRequiredFields.join(', ')}`);
                    }
                }
                
                // 同意項目の自動設定を抽出
                console.log('🔍 autoConsentFields チェック:', {
                    exists: !!autoConsentFields,
                    type: typeof autoConsentFields,
                    value: autoConsentFields
                });
                
                if (autoConsentFields && typeof autoConsentFields === 'object') {
                    extractionResult.autoConsentFields = autoConsentFields;
                    const consentItems = Object.keys(autoConsentFields);
                    console.log('🤝 同意項目自動設定:', {
                        items: consentItems,
                        values: autoConsentFields
                    });
                    if (consentItems.length > 0) {
                        extractionResult.warnings.push(`同意項目自動設定: ${consentItems.join(', ')}`);
                        console.log('✅ 同意項目設定完了:', autoConsentFields);
                    }
                } else {
                    console.log('❌ autoConsentFields が見つからないか、オブジェクトではありません');
                }
            }
            
            // RAコメントから追加必須項目を抽出
            const raRequiredFields = extractRequiredFieldsFromRA(raMemoRaw);
            if (raRequiredFields.length > 0) {
                extractionResult.raCommentFields = raRequiredFields;
                extractionResult.additionalRequiredFields = [...extractionResult.additionalRequiredFields, ...raRequiredFields];
                // 重複除去
                extractionResult.additionalRequiredFields = [...new Set(extractionResult.additionalRequiredFields)];
                extractionResult.warnings.push(`RAコメントから追加必須項目を検出: ${raRequiredFields.join(', ')}`);
            }
            
            // パターン: "W送付" の後を求人名として読む（※がある場合はそこで区切る）
            const wSendPattern = /W送付\s*(.+)/;
            const wSendMatch = raMemoRaw.match(wSendPattern);
            
            if (wSendMatch && wSendMatch[1]) {
                let afterWSend = wSendMatch[1].trim();
                let jobName;
                
                // ※がある場合は、そこで区切る
                if (afterWSend.includes('※')) {
                    jobName = afterWSend.split('※')[0].trim();
                } else {
                    // ※がない場合は、W送付の後全体を求人名とする
                    jobName = afterWSend;
                }
                
                // 安全性チェック
                if (jobName.length < 3) {
                    extractionResult.errors.push("抽出された求人名が短すぎます");
                    return extractionResult;
                }
                
                if (jobName.length > 100) {
                    extractionResult.errors.push("抽出された求人名が長すぎます");
                    return extractionResult;
                }
                
                extractionResult.success = true;
                extractionResult.extractedName = jobName;
                extractionResult.confidence = 95;
                extractionResult.method = 'ra_memo_pattern_extraction_flexible';
                
                // 追加の検証
                if (jobName.includes('【') && jobName.includes('】')) {
                    extractionResult.confidence = 98;
                    extractionResult.warnings.push("役職情報を含む求人名を検出");
                }
                
                return extractionResult;
            } else {
                extractionResult.errors.push("ra_memo_rawから「W送付」パターンを抽出できませんでした");
                return extractionResult;
            }
        }

        // 3. どちらの形式でもない場合
        extractionResult.errors.push("認識可能な求人名フィールドが見つかりませんでした");
        return extractionResult;

    } catch (error) {
        extractionResult.errors.push(`抽出処理中にエラーが発生しました: ${error.message}`);
        return extractionResult;
    }
}

// RAコメントから追加必須項目を抽出
function extractRequiredFieldsFromRA(raComment) {
    const afterNote = raComment.split('※')[1];
    if (!afterNote) return [];
    
    const requiredFields = [];
    const detectionLog = [];
    
    // 年収関連のルール定義
    const salaryRules = {
        currentSalary: {
            patterns: [/現年収[：:\s]*(\d+|０)万円?/g, /現在年収[：:\s]*(\d+|０)万円?/g],
            fieldNames: ['現在の年収', '年収（現在）', '現年収'],
            specialCases: { '０': '退職ケース', '0': '退職ケース' }
        },
        desiredSalary: {
            patterns: [/希望年収[：:\s]*(\d+)万円?/g],
            fieldNames: ['希望年収', '年収（希望）'],
            contextCheck: true
        },
        minimumSalary: {
            patterns: [/最低[希望]*年収[：:\s]*(\d+)万円?/g],
            fieldNames: ['最低希望年収', '年収（最低）']
        }
    };
    
    // その他のルール定義
    const otherRules = {
        salaryNote: {
            patterns: [/希望年収.*?[【（\[].*?(仮|面談|確認).*?[】）\]]/g],
            fieldNames: ['その他希望条件', 'その他の希望条件', '備考']
        },
        currentCompany: {
            patterns: [/現職[はわ：:\s]*(.+?)[株式会社|会社|Corporation|Corp]/g],
            fieldNames: ['現所属', '現在の所属', '勤務先']
        }
    };
    
    // 年収関連をチェック
    Object.entries(salaryRules).forEach(([type, rule]) => {
        rule.patterns.forEach(pattern => {
            const matches = afterNote.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    // 特殊ケース処理（退職等）
                    if (rule.specialCases) {
                        const valueMatch = match.match(/(\d+|０)/);
                        if (valueMatch) {
                            const value = valueMatch[1];
                            if (rule.specialCases[value]) {
                                detectionLog.push(`${type}: ${rule.specialCases[value]} - ${match}`);
                            }
                        }
                    }
                    
                    // 希望年収の場合は後続文言もチェック
                    if (rule.contextCheck && type === 'desiredSalary') {
                        if (otherRules.salaryNote.patterns.some(p => afterNote.match(p))) {
                            requiredFields.push(...otherRules.salaryNote.fieldNames);
                            detectionLog.push('希望年収補足文言検出 → その他希望条件を必須化');
                        }
                    }
                    
                    requiredFields.push(...rule.fieldNames);
                    detectionLog.push(`${type}検出: ${match}`);
                });
            }
        });
    });
    
    // その他条件をチェック
    Object.entries(otherRules).forEach(([type, rule]) => {
        if (type === 'salaryNote') return; // 上で処理済み
        
        rule.patterns.forEach(pattern => {
            const matches = afterNote.match(pattern);
            if (matches) {
                requiredFields.push(...rule.fieldNames);
                detectionLog.push(`${type}検出: ${matches[0]}`);
            }
        });
    });
    
    // 許可されたフィールドのみをフィルタリング
    const allowedFields = [
        // 年収関連
        '現在の年収', '年収（現在）', '現年収',
        '希望年収', '年収（希望）',
        '最低希望年収', '年収（最低）',
        // その他希望条件
        'その他希望条件', 'その他の希望条件', '備考',
        // 現所属
        '現所属', '現在の所属', '勤務先'
    ];
    
    const uniqueFields = [...new Set(requiredFields)];
    const filteredFields = uniqueFields.filter(field => allowedFields.includes(field));
    const rejectedFields = uniqueFields.filter(field => !allowedFields.includes(field));
    
    if (rejectedFields.length > 0) {
        detectionLog.push(`未対応項目を除外: ${rejectedFields.join(', ')}`);
        
        // 曖昧な表現の警告
        const ambiguousTerms = ['履歴書', '職務経歴書', '経歴', 'スキル', '資格', '学歴'];
        const foundAmbiguous = rejectedFields.filter(field => 
            ambiguousTerms.some(term => field.includes(term))
        );
        
        if (foundAmbiguous.length > 0) {
            detectionLog.push(`⚠️ 曖昧な表現を検出（解釈困難のため除外）: ${foundAmbiguous.join(', ')}`);
        }
    }
    
    console.log('RAコメント解析:', {
        originalText: afterNote,
        detectedElements: detectionLog,
        requiredFields: filteredFields,
        rejectedFields: rejectedFields.length > 0 ? rejectedFields : undefined
    });
    
    return filteredFields;
}

// 文字列正規化関数
function normalizeJobName(jobName) {
    if (!jobName || typeof jobName !== 'string') {
        return '';
    }
    
    return jobName
        // 全角・半角スペースを除去
        .replace(/[\s　]/g, '')
        // 記号を統一
        .replace(/[・]/g, '/')
        .replace(/[－−]/g, '-')
        .replace(/[〈〉]/g, match => match === '〈' ? '（' : '）')
        // 小文字に統一
        .toLowerCase();
}

// 装飾文字を除去する関数
function removeDecorations(jobName) {
    if (!jobName || typeof jobName !== 'string') {
        return '';
    }
    
    return jobName
        // 装飾的な括弧や記号を除去
        .replace(/[【】〈〉（）★☆◆◇■□▲△▼▽]/g, '')
        // 連続する記号を除去
        .replace(/[・\/\-]{2,}/g, '')
        // 前後の記号を除去
        .replace(/^[・\/\-]+|[・\/\-]+$/g, '')
        .trim();
}

// 超厳格なマッチング関数
function ultraStrictJobMatching(extractedName, availableJobs) {
    const matchResult = {
        success: false,
        matchedJob: null,
        matchType: null,
        confidence: 0,
        alternatives: [],
        warnings: [],
        errors: [],
        details: {
            extractedName,
            normalizedExtracted: null,
            coreExtracted: null,
            checkedJobs: [],
            allMatches: [] // 全てのマッチした求人を記録
        }
    };

    try {
        if (!extractedName || !Array.isArray(availableJobs) || availableJobs.length === 0) {
            matchResult.errors.push("入力データが不正です");
            return matchResult;
        }

        // 正規化処理
        const normalizedExtracted = normalizeJobName(extractedName);
        const coreExtracted = removeDecorations(normalizedExtracted);
        
        matchResult.details.normalizedExtracted = normalizedExtracted;
        matchResult.details.coreExtracted = coreExtracted;

        sendLog(`抽出された求人名の正規化: "${extractedName}" → "${normalizedExtracted}" → "${coreExtracted}"`);

        // 各マッチレベルでの候補を収集
        const exactMatches = [];
        const normalizedMatches = [];
        const coreMatches = [];
        const subsetMatches = [];

        for (const job of availableJobs) {
            const normalizedJob = normalizeJobName(job);
            const coreJob = removeDecorations(normalizedJob);
            
            const jobCheck = {
                original: job,
                normalized: normalizedJob,
                core: coreJob,
                matchType: null,
                confidence: 0
            };

            // 1. 完全一致チェック
            if (extractedName === job) {
                exactMatches.push({job, jobCheck, confidence: 100, type: 'exact'});
                jobCheck.matchType = 'exact';
                jobCheck.confidence = 100;
                sendLog(`完全一致発見: "${extractedName}" = "${job}"`, 'success');
            }
            // 2. 正規化後完全一致チェック
            else if (normalizedExtracted === normalizedJob) {
                normalizedMatches.push({job, jobCheck, confidence: 95, type: 'normalized_exact'});
                jobCheck.matchType = 'normalized_exact';
                jobCheck.confidence = 95;
                sendLog(`正規化後完全一致発見: "${normalizedExtracted}" = "${normalizedJob}"`, 'success');
            }
            // 3. 装飾除去後完全一致チェック
            else if (coreExtracted === coreJob) {
                coreMatches.push({job, jobCheck, confidence: 90, type: 'core_exact'});
                jobCheck.matchType = 'core_exact';
                jobCheck.confidence = 90;
                sendLog(`装飾除去後完全一致発見: "${coreExtracted}" = "${coreJob}"`, 'success');
            }
            // 4. 厳格な部分一致チェック
            else if (coreJob.length >= 3 && coreExtracted.includes(coreJob)) {
                const remaining = coreExtracted.replace(coreJob, '');
                const allowedRemainingPattern = /^[・\/\-]*$/;
                
                if (allowedRemainingPattern.test(remaining)) {
                    let allCharsIncluded = true;
                    for (const char of coreJob) {
                        if (!coreExtracted.includes(char)) {
                            allCharsIncluded = false;
                            break;
                        }
                    }
                    
                    if (allCharsIncluded) {
                        subsetMatches.push({job, jobCheck, confidence: 85, type: 'strict_subset', remaining});
                        jobCheck.matchType = 'strict_subset';
                        jobCheck.confidence = 85;
                        sendLog(`厳格な部分一致発見: "${coreExtracted}" ⊃ "${coreJob}" (残り: "${remaining}")`, 'warning');
                    }
                }
            }

            matchResult.details.checkedJobs.push(jobCheck);
        }

        // 全てのマッチを記録
        const allMatches = [...exactMatches, ...normalizedMatches, ...coreMatches, ...subsetMatches];
        matchResult.details.allMatches = allMatches.map(match => ({
            job: match.job,
            type: match.type,
            confidence: match.confidence,
            remaining: match.remaining || null
        }));

        // 複数マッチの安全性チェック
        if (exactMatches.length > 1) {
            matchResult.errors.push(`複数の求人が完全一致しました（${exactMatches.length}件）- 安全性のため処理を停止します`);
            matchResult.alternatives = exactMatches.map(m => m.job);
            sendLog(`危険: 複数の完全一致を検出 - ${exactMatches.map(m => m.job).join(', ')}`, 'error');
            return matchResult;
        }

        if (normalizedMatches.length > 1) {
            matchResult.errors.push(`複数の求人が正規化後一致しました（${normalizedMatches.length}件）- 安全性のため処理を停止します`);
            matchResult.alternatives = normalizedMatches.map(m => m.job);
            sendLog(`危険: 複数の正規化後一致を検出 - ${normalizedMatches.map(m => m.job).join(', ')}`, 'error');
            return matchResult;
        }

        if (coreMatches.length > 1) {
            matchResult.errors.push(`複数の求人が装飾除去後一致しました（${coreMatches.length}件）- 安全性のため処理を停止します`);
            matchResult.alternatives = coreMatches.map(m => m.job);
            sendLog(`危険: 複数の装飾除去後一致を検出 - ${coreMatches.map(m => m.job).join(', ')}`, 'error');
            return matchResult;
        }

        // 複数レベルでのマッチも危険
        const totalHighConfidenceMatches = exactMatches.length + normalizedMatches.length + coreMatches.length;
        if (totalHighConfidenceMatches > 1) {
            const allHighMatches = [...exactMatches, ...normalizedMatches, ...coreMatches];
            matchResult.errors.push(`複数の求人が異なるレベルでマッチしました（${totalHighConfidenceMatches}件）- 安全性のため処理を停止します`);
            matchResult.alternatives = allHighMatches.map(m => m.job);
            sendLog(`危険: 複数レベルでのマッチを検出 - ${allHighMatches.map(m => `${m.job}(${m.type})`).join(', ')}`, 'error');
            return matchResult;
        }

        // 単一マッチの場合のみ処理を続行
        if (exactMatches.length === 1) {
            const match = exactMatches[0];
            matchResult.success = true;
            matchResult.matchedJob = match.job;
            matchResult.matchType = match.type;
            matchResult.confidence = match.confidence;
            sendLog(`安全な単一完全一致: "${extractedName}" = "${match.job}"`, 'success');
            return matchResult;
        }

        if (normalizedMatches.length === 1) {
            const match = normalizedMatches[0];
            matchResult.success = true;
            matchResult.matchedJob = match.job;
            matchResult.matchType = match.type;
            matchResult.confidence = match.confidence;
            sendLog(`安全な単一正規化後一致: "${normalizedExtracted}" = "${normalizeJobName(match.job)}"`, 'success');
            return matchResult;
        }

        if (coreMatches.length === 1) {
            const match = coreMatches[0];
            matchResult.success = true;
            matchResult.matchedJob = match.job;
            matchResult.matchType = match.type;
            matchResult.confidence = match.confidence;
            sendLog(`安全な単一装飾除去後一致: "${coreExtracted}" = "${removeDecorations(normalizeJobName(match.job))}"`, 'success');
            return matchResult;
        }

        // 部分一致は信頼度不足で拒否（複数チェックは不要、どのみち拒否される）
        if (subsetMatches.length > 0) {
            const match = subsetMatches[0]; // 最初の一つだけ参照
            matchResult.matchedJob = match.job;
            matchResult.matchType = match.type;
            matchResult.confidence = 85;
            matchResult.warnings.push(`部分一致検出: "${coreExtracted}" に "${removeDecorations(normalizeJobName(match.job))}" が含まれています（残り: "${match.remaining}"）`);
            matchResult.warnings.push("部分一致のため信頼度が不足しています（85% < 90%）");
            matchResult.errors.push("部分一致は安全性のため拒否されました");
            
            if (subsetMatches.length > 1) {
                matchResult.warnings.push(`注意: ${subsetMatches.length}件の部分一致候補がありましたが、いずれも拒否されました`);
                matchResult.alternatives = subsetMatches.map(m => m.job);
            }
            
            sendLog(`部分一致拒否: 信頼度不足 (85% < 90%)`, 'warning');
            return matchResult;
        }

        // どのパターンにもマッチしなかった場合
        matchResult.errors.push("厳格な条件でマッチする求人が見つかりませんでした");
        sendLog(`マッチング失敗: "${extractedName}" に対応する求人が見つかりません`, 'error');
        
        return matchResult;

    } catch (error) {
        matchResult.errors.push(`マッチング処理中にエラーが発生しました: ${error.message}`);
        sendLog(`マッチング処理エラー: ${error.message}`, 'error');
        return matchResult;
    }
}

// 安全性を重視したマッチング（旧関数を置き換え）
function safeJobMatching(extractedName, availableJobs) {
    sendLog("超厳格マッチングロジックを開始します");
    return ultraStrictJobMatching(extractedName, availableJobs);
}

// マッチした求人に対応する「この職種に推薦する」ボタンをクリックする関数
async function clickRecommendationButton(page, targetJobName) {
    const clickResult = {
        success: false,
        error: null,
        targetJobName,
        buttonFound: false,
        clickAttempted: false,
        details: {}
    };

    try {
        sendLog(`対象求人「${targetJobName}」に対応するボタンを検索中...`);

        // ページ内の全ての「この職種に推薦する」ボタンとその対応する求人名を取得
        const buttonJobPairs = await page.evaluate(() => {
            const pairs = [];
            
            // 「この職種に推薦する」ボタンを全て取得
            const recommendationButtons = document.querySelectorAll('button');
            const validButtons = Array.from(recommendationButtons).filter(btn => 
                btn.textContent && btn.textContent.includes('この職種に推薦する')
            );
            
            console.log(`推薦ボタンを${validButtons.length}個見つけました`);
            
            validButtons.forEach((button, index) => {
                let currentElement = button;
                let jobName = null;
                let searchDepth = 0;
                
                // ボタンから上位要素を辿って対応する求人名を探す
                while (currentElement && searchDepth < 15) {
                    currentElement = currentElement.parentElement;
                    if (!currentElement) break;
                    searchDepth++;
                    
                    // 方法1: .agent-requisitions-table-list__cell.--name クラスを探す
                    const nameCell = currentElement.querySelector('.agent-requisitions-table-list__cell.--name');
                    if (nameCell) {
                        const anchor = nameCell.querySelector('a');
                        if (anchor && anchor.textContent) {
                            jobName = anchor.textContent.trim();
                            break;
                        }
                    }
                    
                    // 方法2: テーブル行の最初の列（td:first-child）を探す
                    const firstCell = currentElement.querySelector('td:first-child');
                    if (firstCell) {
                        const anchor = firstCell.querySelector('a');
                        if (anchor && anchor.textContent) {
                            jobName = anchor.textContent.trim();
                            break;
                        }
                        
                        // アンカータグがない場合、直接テキストを取得
                        const cellText = firstCell.textContent.trim();
                        if (cellText && cellText.length > 2 && !cellText.includes('この職種に推薦する')) {
                            jobName = cellText;
                            break;
                        }
                    }
                    
                    // 方法3: 同じ行（tr）内の最初のセルを探す
                    const row = currentElement.closest('tr');
                    if (row) {
                        const firstTd = row.querySelector('td:first-child');
                        if (firstTd) {
                            const anchor = firstTd.querySelector('a');
                            if (anchor && anchor.textContent) {
                                jobName = anchor.textContent.trim();
                                break;
                            }
                            
                            const cellText = firstTd.textContent.trim();
                            if (cellText && cellText.length > 2 && !cellText.includes('この職種に推薦する')) {
                                jobName = cellText;
                                break;
                            }
                        }
                    }
                }
                
                if (jobName) {
                    pairs.push({
                        jobName: jobName,
                        buttonIndex: index,
                        searchDepth: searchDepth,
                        button: button
                    });
                    console.log(`ボタン${index}: "${jobName}" (検索深度: ${searchDepth})`);
                } else {
                    console.log(`ボタン${index}: 求人名が見つかりませんでした`);
                }
            });
            
            return pairs;
        });

        clickResult.details.foundPairs = buttonJobPairs.length;
        clickResult.details.pairs = buttonJobPairs.map(pair => ({
            jobName: pair.jobName,
            buttonIndex: pair.buttonIndex,
            searchDepth: pair.searchDepth
        }));

        sendLog(`${buttonJobPairs.length}個のボタン-求人ペアを検出しました`);
        
        // 対象求人名と完全一致するボタンを探す
        const exactMatch = buttonJobPairs.find(pair => pair.jobName === targetJobName);
        
        if (exactMatch) {
            clickResult.buttonFound = true;
            sendLog(`完全一致するボタンを発見: "${exactMatch.jobName}" (ボタンインデックス: ${exactMatch.buttonIndex})`);
            
            // ボタンをクリック
            const clickSuccess = await page.evaluate((buttonIndex) => {
                const recommendationButtons = document.querySelectorAll('button');
                const validButtons = Array.from(recommendationButtons).filter(btn => 
                    btn.textContent && btn.textContent.includes('この職種に推薦する')
                );
                
                if (validButtons[buttonIndex]) {
                    try {
                        validButtons[buttonIndex].click();
                        return true;
                    } catch (error) {
                        console.error('ボタンクリックエラー:', error);
                        return false;
                    }
                }
                return false;
            }, exactMatch.buttonIndex);
            
            clickResult.clickAttempted = true;
            
            if (clickSuccess) {
                clickResult.success = true;
                sendLog(`「${targetJobName}」の推薦ボタンクリックに成功しました`, 'success');
                
                // クリック後の確認（少し待機）
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } else {
                clickResult.error = 'ボタンクリックの実行に失敗しました';
                sendLog(`ボタンクリックの実行に失敗: ${targetJobName}`, 'error');
            }
            
        } else {
            // 完全一致しない場合は、正規化して再検索
            const normalizedTarget = normalizeJobName(targetJobName);
            const normalizedMatch = buttonJobPairs.find(pair => 
                normalizeJobName(pair.jobName) === normalizedTarget
            );
            
            if (normalizedMatch) {
                clickResult.buttonFound = true;
                sendLog(`正規化後一致するボタンを発見: "${normalizedMatch.jobName}" → "${targetJobName}"`);
                
                const clickSuccess = await page.evaluate((buttonIndex) => {
                    const recommendationButtons = document.querySelectorAll('button');
                    const validButtons = Array.from(recommendationButtons).filter(btn => 
                        btn.textContent && btn.textContent.includes('この職種に推薦する')
                    );
                    
                    if (validButtons[buttonIndex]) {
                        try {
                            validButtons[buttonIndex].click();
                            return true;
                        } catch (error) {
                            console.error('ボタンクリックエラー:', error);
                            return false;
                        }
                    }
                    return false;
                }, normalizedMatch.buttonIndex);
                
                clickResult.clickAttempted = true;
                
                if (clickSuccess) {
                    clickResult.success = true;
                    sendLog(`「${targetJobName}」の推薦ボタンクリック（正規化一致）に成功しました`, 'success');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    clickResult.error = 'ボタンクリックの実行に失敗しました（正規化一致）';
                    sendLog(`ボタンクリックの実行に失敗（正規化一致）: ${targetJobName}`, 'error');
                }
            } else {
                clickResult.error = `対象求人「${targetJobName}」に対応するボタンが見つかりませんでした`;
                sendLog(`対応するボタンが見つかりません: ${targetJobName}`, 'error');
                sendLog(`利用可能な求人: ${buttonJobPairs.map(p => p.jobName).join(', ')}`);
            }
        }

    } catch (error) {
        clickResult.error = `ボタンクリック処理中にエラーが発生しました: ${error.message}`;
        sendLog(`ボタンクリック処理エラー: ${error.message}`, 'error');
    }

    return clickResult;
}

// 推薦ページのフォーム項目を解析する関数
async function analyzeRecommendationForm(page, jobName, additionalRequiredFields = [], raCommentFields = [], autoConsentFields = {}) {
    const analysisResult = {
        success: false,
        error: null,
        jobName: jobName,
        timestamp: new Date().toISOString(),
        totalFields: 0,
        requiredFields: 0,
        optionalFields: 0,
        fields: [],
        pageUrl: null,
        companyName: null,
        additionalRequiredOverrides: {
            specifiedFields: additionalRequiredFields || [],
            raCommentFields: raCommentFields || [],
            appliedCount: 0,
            appliedFields: []
        },
        autoConsentFields: autoConsentFields || {}
    };

    try {
        // 現在のページURLを取得
        analysisResult.pageUrl = await page.url();
        sendLog(`フォーム解析開始: ${analysisResult.pageUrl}`);

        // ページ内のフォーム項目を解析
        console.log('🚀 page.evaluate実行前のautoConsentFields:', autoConsentFields);
        const formData = await page.evaluate((autoConsentFields) => {
            // autoConsentFieldsをwindowオブジェクトに設定してアクセス可能にする
            console.log('🌐 page.evaluate内でのautoConsentFields:', autoConsentFields);
            window.autoConsentFields = autoConsentFields;
            const fields = [];
            let companyName = null;

            // 会社名を取得（複数の方法で試行）
            const companySelectors = [
                'h1', 'h2', '.company-name', '[class*="company"]', 
                '.title', '[class*="title"]'
            ];
            
            for (const selector of companySelectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent) {
                    const text = element.textContent.trim();
                    if (text.includes('株式会社') || text.includes('(株)') || text.includes('会社')) {
                        companyName = text;
                        break;
                    }
                }
            }

            // フォーム項目を検索
            const formElements = document.querySelectorAll('input, textarea, select');
            const labeledFormItems = document.querySelectorAll('.labeled-form-item, [class*="form-item"], [class*="field"]');

            // 方法1: labeled-form-itemクラスを使用
            // 重複排除用のセット
            const processedFieldNames = new Set();
            
            labeledFormItems.forEach((item, index) => {
                try {
                    const labelElement = item.querySelector('[class*="label"]');
                    const requiredElement = item.querySelector('[class*="required"], .required, [data-required="true"]');
                    const optionalElement = item.querySelector('[class*="optional"], .optional, [data-optional="true"]');
                    const inputElement = item.querySelector('input, textarea, select');
                    
                    // チェックボックス項目の場合、より広範囲で必須/任意マークを探す
                    let additionalRequiredElement = null;
                    let additionalOptionalElement = null;
                    if (inputElement && inputElement.type === 'checkbox') {
                        // 親要素や兄弟要素も含めて必須/任意マークを探す
                        const parentElement = item.parentElement;
                        if (parentElement) {
                            additionalRequiredElement = parentElement.querySelector('[class*="required"], .required, span[style*="color: red"], span[style*="color:#red"]');
                            additionalOptionalElement = parentElement.querySelector('[class*="optional"], .optional');
                        }
                    }

                    let fieldName = 'Unknown Field';
                    let isRequired = false;
                    let fieldType = 'text';
                    let detectionMethod = 'labeled-form-item';

                    // ラベルテキストを取得
                    if (labelElement) {
                        fieldName = labelElement.textContent.trim();
                        // 「*」や「必須」などの文字を除去
                        fieldName = fieldName.replace(/[*＊]/g, '').replace(/必須|任意/g, '').trim();
                    }

                    // 必須/任意の判定（シンプルに要素の存在で判定）
                    if (requiredElement || additionalRequiredElement) {
                        // requiredElementが存在する場合は必須
                        isRequired = true;
                        detectionMethod += ' + required-element';
                    } else if (optionalElement || additionalOptionalElement) {
                        // optionalElementが存在する場合は任意
                        isRequired = false;
                        detectionMethod += ' + optional-element';
                    } else {
                        // テキスト内容による判定
                        const itemText = item.textContent || '';
                        const parentText = item.parentElement ? item.parentElement.textContent || '' : '';
                        const allText = itemText + ' ' + parentText;
                        
                        if (allText.includes('必須') || allText.includes('*') || allText.includes('＊')) {
                            isRequired = true;
                            detectionMethod += ' + text-required';
                        } else if (allText.includes('任意')) {
                            isRequired = false;
                            detectionMethod += ' + text-optional';
                        } else {
                            // 色による判定
                            const computedStyle = window.getComputedStyle(labelElement || item);
                            const color = computedStyle.color;
                            const backgroundColor = computedStyle.backgroundColor;
                            
                            // 赤系の色は必須、灰色系は任意
                            if (color.includes('rgb(255') || color.includes('red') || backgroundColor.includes('red')) {
                                isRequired = true;
                                detectionMethod += ' + red-color';
                            } else if (color.includes('rgb(128') || color.includes('gray') || color.includes('grey')) {
                                isRequired = false;
                                detectionMethod += ' + gray-color';
                            }
                        }
                    }

                    // 入力タイプを取得
                    if (inputElement) {
                        fieldType = inputElement.type || inputElement.tagName.toLowerCase();
                    }

                    // Unknown Fieldと不要項目（推薦元、職種）を除外し、名前が取得できたフィールドのみを追加
                    if (fieldName !== 'Unknown Field' && fieldName.trim() !== '' && 
                        fieldName !== '推薦元' && fieldName !== '職種') {
                        
                        // 自動同意フィールドかどうかをチェック
                        let isAutoConsent = false;
                        let autoConsentValue = null;
                        
                        // フィールド名の類似性をチェック（完全一致を優先、部分一致は補完）
                        console.log(`🔍 同意フィールドチェック: "${fieldName}", autoConsentFields:`, window.autoConsentFields);
                        
                        // まず完全一致をチェック
                        for (const [consentFieldName, consentValue] of Object.entries(window.autoConsentFields || {})) {
                            if (fieldName === consentFieldName) {
                                console.log(`  🎯 完全マッチ! ${fieldName} → ${consentValue}`);
                                isAutoConsent = true;
                                autoConsentValue = consentValue;
                                fieldType = 'text';
                                break;
                            }
                        }
                        
                        // 完全一致しない場合のみ部分一致をチェック
                        if (!isAutoConsent) {
                            for (const [consentFieldName, consentValue] of Object.entries(window.autoConsentFields || {})) {
                                console.log(`  🔸 部分一致比較: "${fieldName}" vs "${consentFieldName}"`);
                                if (fieldName.includes(consentFieldName) || consentFieldName.includes(fieldName)) {
                                    console.log(`  ✅ 部分マッチ! ${fieldName} → ${consentValue}`);
                                    isAutoConsent = true;
                                    autoConsentValue = consentValue;
                                    fieldType = 'text';
                                    console.log(`  📝 タイプ変更: checkbox → text`);
                                    break;
                                }
                            }
                        }
                        
                        // 🔄 重複チェック：Setを使用した効率的な重複チェック
                        const isDuplicate = processedFieldNames.has(fieldName);
                        
                        // 🎯 同意フィールドの場合は、textタイプを優先（チェックボックスは除外）
                        if (isAutoConsent && fieldType === 'checkbox') {
                            console.log(`  ⏭️ 同意フィールドのチェックボックス版をスキップ: "${fieldName}"`);
                            // スキップしたフィールドも処理済みとしてマーク（重複防止のため）
                            processedFieldNames.add(fieldName);
                        } else if (!isDuplicate) {
                            // フィールド名を処理済みとしてマーク
                            processedFieldNames.add(fieldName);
                            // 重複していない場合のみ追加
                            fields.push({
                                index: index + 1,
                                name: fieldName,
                                type: fieldType,
                                required: isRequired,
                                detectionMethod: detectionMethod,
                                hasLabel: !!labelElement,
                                hasRequiredIndicator: !!requiredElement,
                                hasOptionalIndicator: !!optionalElement,
                                hasInput: !!inputElement,
                                isAutoConsent: isAutoConsent,
                                autoConsentValue: autoConsentValue
                            });
                        } else {
                            console.log(`  🔄 重複フィールドをスキップ: "${fieldName}"`);
                        }
                    }

                } catch (error) {
                    console.error(`フィールド${index}の解析エラー:`, error);
                }
            });

            // 方法2: 一般的なフォーム要素を直接検索（補完用）
            if (fields.length === 0) {
                formElements.forEach((element, index) => {
                    try {
                        let fieldName = 'Unknown Field';
                        let isRequired = false;
                        let detectionMethod = 'direct-form-element';

                        // ラベルを探す
                        const id = element.id;
                        const name = element.name;
                        let labelElement = null;

                        if (id) {
                            labelElement = document.querySelector(`label[for="${id}"]`);
                        }
                        
                        if (!labelElement && name) {
                            labelElement = document.querySelector(`label[for="${name}"]`);
                        }

                        if (!labelElement) {
                            // 親要素からラベルを探す
                            let parent = element.parentElement;
                            for (let i = 0; i < 3 && parent; i++) {
                                const label = parent.querySelector('label');
                                if (label) {
                                    labelElement = label;
                                    break;
                                }
                                parent = parent.parentElement;
                            }
                        }

                        if (labelElement) {
                            fieldName = labelElement.textContent.trim();
                            fieldName = fieldName.replace(/[*＊]/g, '').replace(/必須|任意/g, '').trim();
                        } else if (element.placeholder) {
                            fieldName = element.placeholder;
                        } else if (name) {
                            fieldName = name;
                        }

                        // 必須属性をチェック
                        if (element.hasAttribute('required')) {
                            isRequired = true;
                            detectionMethod += ' + required-attribute';
                        }

                        fields.push({
                            index: fields.length + 1,
                            name: fieldName,
                            type: element.type || element.tagName.toLowerCase(),
                            required: isRequired,
                            detectionMethod: detectionMethod,
                            hasLabel: !!labelElement,
                            hasRequiredIndicator: false,
                            hasOptionalIndicator: false,
                            hasInput: true
                        });

                    } catch (error) {
                        console.error(`要素${index}の解析エラー:`, error);
                    }
                });
            }

            // 🔧 重複フィールドの強制削除（ブラウザ側で実行）
            console.log(`🔧 重複削除前のフィールド数: ${fields.length}`);
            console.log(`🔧 削除処理開始 - 現在のフィールド一覧:`, fields.map(f => `${f.name}(${f.type})`));
            
            // 削除対象フィールドを特定
            const fieldsToRemove = [];
            
            // 「登録内容の確認」(checkbox)を削除
            const registrationCheckboxIndex = fields.findIndex(f => 
                f.name === '登録内容の確認' && f.type === 'checkbox'
            );
            if (registrationCheckboxIndex !== -1) {
                fieldsToRemove.push(registrationCheckboxIndex);
                console.log(`🗑️ 削除対象: 「登録内容の確認」(checkbox) at index ${registrationCheckboxIndex}`);
            }
            
            // 「個人情報の取り扱いに同意します」(checkbox)を削除
            const privacyCheckboxIndex = fields.findIndex(f => 
                f.name === '個人情報の取り扱いに同意します' && f.type === 'checkbox'
            );
            if (privacyCheckboxIndex !== -1) {
                fieldsToRemove.push(privacyCheckboxIndex);
                console.log(`🗑️ 削除対象: 「個人情報の取り扱いに同意します」(checkbox) at index ${privacyCheckboxIndex}`);
            }
            
            // 後ろから削除（インデックスがずれないように）
            try {
                fieldsToRemove.sort((a, b) => b - a).forEach(index => {
                    const removedField = fields.splice(index, 1)[0];
                    console.log(`✂️ フィールド削除完了: 「${removedField.name}」(${removedField.type})`);
                });
                
                console.log(`✅ 重複削除後のフィールド数: ${fields.length}`);
            } catch (error) {
                console.error(`❌ 削除処理エラー:`, error);
            }

            return {
                fields: fields,
                companyName: companyName,
                totalElements: formElements.length,
                labeledItems: labeledFormItems.length
            };
        }, autoConsentFields);

        analysisResult.fields = formData.fields;
        analysisResult.companyName = formData.companyName;
        
        // 追加必須項目の適用（JSON指定項目とRAコメント項目を統合処理）
        const allAdditionalFields = [...(additionalRequiredFields || []), ...(raCommentFields || [])];
        if (allAdditionalFields.length > 0) {
            allAdditionalFields.forEach(requiredField => {
                const matches = analysisResult.fields.filter(field => {
                    const fieldName = field.name.toLowerCase();
                    const requiredName = requiredField.toLowerCase();
                    
                    // より厳密なマッチングロジック
                    let isMatch = false;
                    
                    // 1. 完全一致
                    if (fieldName === requiredName) {
                        isMatch = true;
                    }
                    // 2. 特定の年収関連項目の厳密マッチング
                    else if (requiredName.includes('年収')) {
                        // 現在の年収系
                        if ((requiredName.includes('現在') || requiredName.includes('現年収')) && 
                            ((fieldName.includes('現在') && fieldName.includes('年収')) || fieldName.includes('現年収')) && 
                            !fieldName.includes('希望') && !fieldName.includes('最低')) {
                            isMatch = true;
                        }
                        // 希望年収系
                        else if (requiredName.includes('希望') && 
                                (fieldName.includes('希望') && fieldName.includes('年収')) && 
                                !fieldName.includes('最低')) {
                            isMatch = true;
                        }
                        // 最低年収系
                        else if (requiredName.includes('最低') && 
                                (fieldName.includes('最低') && fieldName.includes('年収'))) {
                            isMatch = true;
                        }
                    }
                    // 3. その他の項目は部分一致（ただし経歴と職務経歴書の混線を防ぐ）
                    else {
                        // 経歴フィールドの特別処理：職務経歴書への混線を防ぐ
                        if (requiredName === '経歴' && fieldName === '職務経歴書') {
                            isMatch = false; // 明示的に除外
                            console.log(`⏭️ フィールドマッチング除外: "${requiredField}" → "${field.name}" (職務経歴書は除外)`);
                        } else if (requiredName === '職務経歴書' && fieldName === '経歴') {
                            isMatch = false; // 逆方向も除外
                            console.log(`⏭️ フィールドマッチング除外: "${requiredField}" → "${field.name}" (経歴は除外)`);
                        } else if (requiredName === '履歴書') {
                            // 履歴書は完全一致のみ許可（部分一致による混線を防ぐ）
                            isMatch = (fieldName === '履歴書');
                            if (!isMatch) {
                                console.log(`⏭️ フィールドマッチング除外: "${requiredField}" → "${field.name}" (履歴書は完全一致のみ)`);
                            }
                        } else {
                            isMatch = fieldName.includes(requiredName) || requiredName.includes(fieldName);
                        }
                    }
                    
                    // デバッグログ
                    if (isMatch) {
                        console.log(`フィールドマッチング: "${requiredField}" → "${field.name}" (マッチ)`);
                    }
                    
                    return isMatch;
                });
                
                matches.forEach(field => {
                    if (!field.required) {
                        field.required = true;
                        const sourceType = (raCommentFields || []).includes(requiredField) ? 'RA-comment' : 'JSON-specified';
                        field.detectionMethod += ` + additional-required(${sourceType})`;
                        analysisResult.additionalRequiredOverrides.appliedCount++;
                        analysisResult.additionalRequiredOverrides.appliedFields.push({
                            fieldName: field.name,
                            originalRequired: false,
                            overriddenBy: requiredField,
                            sourceType: sourceType
                        });
                    }
                });
            });
        }
        
        // 重複削除はpage.evaluate内で実行済み
        
        analysisResult.totalFields = analysisResult.fields.length;
        analysisResult.requiredFields = analysisResult.fields.filter(f => f.required).length;
        analysisResult.optionalFields = analysisResult.fields.filter(f => !f.required).length;

        if (analysisResult.totalFields > 0) {
            analysisResult.success = true;
            sendLog(`フォーム解析成功: 合計${analysisResult.totalFields}項目（必須:${analysisResult.requiredFields}, 任意:${analysisResult.optionalFields}）`);
        } else {
            analysisResult.error = 'フォーム項目が見つかりませんでした';
            sendLog('フォーム項目が検出されませんでした', 'warning');
        }

    } catch (error) {
        analysisResult.error = `フォーム解析中にエラーが発生しました: ${error.message}`;
        sendLog(`フォーム解析エラー: ${error.message}`, 'error');
    }

    return analysisResult;
}

// フォーム解析結果をファイルに保存する関数
async function saveFormAnalysisToFile(analysisResult, jobName) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sanitizedJobName = jobName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
        const fileName = `form_analysis_${sanitizedJobName}_${timestamp}.json`;
        const filePath = path.join(__dirname, 'logs/process', fileName);

        // ディレクトリが存在しない場合は作成
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // 保存用のデータを整理
        const saveData = {
            ...analysisResult,
            analysis: {
                summary: {
                    totalFields: analysisResult.totalFields,
                    requiredFields: analysisResult.requiredFields,
                    optionalFields: analysisResult.optionalFields,
                    requiredPercentage: analysisResult.totalFields > 0 ? 
                        Math.round((analysisResult.requiredFields / analysisResult.totalFields) * 100) : 0
                },
                fieldsByType: analysisResult.fields.reduce((acc, field) => {
                    acc[field.type] = (acc[field.type] || 0) + 1;
                    return acc;
                }, {}),
                detectionMethods: analysisResult.fields.reduce((acc, field) => {
                    acc[field.detectionMethod] = (acc[field.detectionMethod] || 0) + 1;
                    return acc;
                }, {})
            }
        };

        fs.writeFileSync(filePath, JSON.stringify(saveData, null, 2), 'utf8');
        
        sendLog(`フォーム解析結果を保存しました: ${fileName}`, 'success');
        
        return {
            fileName: fileName,
            filePath: filePath,
            success: true
        };

    } catch (error) {
        sendLog(`ファイル保存エラー: ${error.message}`, 'error');
        return {
            fileName: null,
            filePath: null,
            success: false,
            error: error.message
        };
    }
}

// フォーム自動入力機能は削除（HERPサイトへの直接入力は行わない）

// PDF解析結果と必須項目をマッピングする関数
async function mapPdfDataToRequiredFields(formAnalysisResult, pdfResult, extractionResult) {
    try {
        const mappingResult = {
            success: true,
            mappedFields: 0,
            mappings: [],
            unmappedFields: [],
            pdfData: {
                name: pdfResult.extractedName,
                furigana: pdfResult.furigana,
                age: pdfResult.age,
                phone: pdfResult.phone,
                email: pdfResult.email,
                recommendationComment: pdfResult.recommendationComment,
                careerSummary: pdfResult.careerSummary,
                confidence: pdfResult.confidence
            },
            raCommentData: {}
        };

        // デバッグ: PDFデータの内容をログ出力
        const extractedItems = [];
        if (pdfResult.extractedName) extractedItems.push(`氏名「${pdfResult.extractedName}」`);
        if (pdfResult.furigana) extractedItems.push(`ふりがな「${pdfResult.furigana}」`);
        if (pdfResult.age) extractedItems.push(`年齢「${pdfResult.age}歳」`);
        if (pdfResult.phone) extractedItems.push(`電話「${pdfResult.phone}」`);
        if (pdfResult.email) extractedItems.push(`メール「${pdfResult.email}」`);
        if (pdfResult.recommendationComment) extractedItems.push(`推薦コメント「${pdfResult.recommendationComment.substring(0, 30)}...」`);
        if (pdfResult.careerSummary) extractedItems.push(`職務要約「${pdfResult.careerSummary.substring(0, 30)}...」`);
        
        // 学歴・職歴詳細データの出力
        if (pdfResult.educationDetails) {
            const eduDetails = pdfResult.educationDetails;
            console.log('\n📚 === 学歴詳細データ ===');
            console.log(`📊 学歴エントリ数: ${eduDetails.educationEntries.length}`);
            eduDetails.educationEntries.forEach((entry, index) => {
                console.log(`  ${index + 1}. ${entry.year}年${entry.month}月: ${entry.content}`);
            });
            console.log(`📚 学歴関連行数: ${eduDetails.rawEducationSection.length}`);
            eduDetails.rawEducationSection.forEach((line, index) => {
                console.log(`  [${index + 1}] ${line}`);
            });
            
            console.log('\n💼 === 職歴詳細データ ===');
            console.log(`📊 職歴エントリ数: ${eduDetails.careerEntries.length}`);
            eduDetails.careerEntries.forEach((entry, index) => {
                console.log(`  ${index + 1}. ${entry.year}年${entry.month}月: ${entry.content}`);
            });
            console.log(`💼 職歴関連行数: ${eduDetails.rawCareerSection.length}`);
            eduDetails.rawCareerSection.forEach((line, index) => {
                console.log(`  [${index + 1}] ${line}`);
            });
            console.log('=========================');
        }

        // PDF解析結果の詳細チェック
        console.log('\n🔍 === PDF解析結果詳細チェック ===');
        console.log(`📦 pdfResult構造:`, Object.keys(pdfResult || {}));
        console.log(`🏢 currentCompany存在: ${!!pdfResult.currentCompany}`);
        console.log(`🎓 finalEducation存在: ${!!pdfResult.finalEducation}`);
        if (pdfResult.currentCompany) {
            console.log(`  🏢 currentCompany内容:`, pdfResult.currentCompany);
        }
        if (pdfResult.finalEducation) {
            console.log(`  🎓 finalEducation内容:`, pdfResult.finalEducation);
        }
        console.log('🔍 === PDF解析結果詳細チェック完了 ===\n');

        // 現所属・最終学歴の抽出結果
        if (pdfResult.currentCompany) {
            console.log('\n🏢 === 現所属抽出結果 ===');
            if (pdfResult.currentCompany.company) {
                console.log(`✅ 現所属: "${pdfResult.currentCompany.company}"`);
                console.log(`📅 入社年月: ${pdfResult.currentCompany.year}年${pdfResult.currentCompany.month}月`);
                console.log(`🎯 信頼度: ${pdfResult.currentCompany.confidence}%`);
            } else {
                console.log('❌ 現所属の抽出に失敗');
            }
        }

        if (pdfResult.finalEducation) {
            console.log('\n🎓 === 最終学歴抽出結果 ===');
            if (pdfResult.finalEducation.education) {
                console.log(`✅ 最終学歴: "${pdfResult.finalEducation.education}"`);
                console.log(`📅 卒業年月: ${pdfResult.finalEducation.year}年${pdfResult.finalEducation.month}月`);
                console.log(`🎯 信頼度: ${pdfResult.finalEducation.confidence}%`);
            } else {
                console.log('❌ 最終学歴の抽出に失敗');
            }
        }
        
        if (extractedItems.length > 0) {
            sendLog(`PDF解析完了: ${extractedItems.join(', ')}`, 'info');
        } else {
            sendLog('PDF解析完了: データが抽出されませんでした', 'warning');
        }
        sendLog(`RAコメント: ${extractionResult.originalData || 'なし'}`, 'info');

        // 必須項目を取得（フロントエンドと同じ判定ロジックを使用）
        const requiredFields = formAnalysisResult.fields.filter(field => field.required);
        
        sendLog(`必須項目 ${requiredFields.length}個をマッピング中...`, 'info');
        console.log('🔍 必須項目一覧:', requiredFields.map(f => f.name));
        console.log('🤝 同意項目設定:', {
            exists: !!extractionResult.autoConsentFields,
            type: typeof extractionResult.autoConsentFields,
            value: extractionResult.autoConsentFields,
            keys: extractionResult.autoConsentFields ? Object.keys(extractionResult.autoConsentFields) : []
        });
        
        // 同意フィールドの存在確認
        const consentFields = requiredFields.filter(f => 
            f.name.includes('登録内容') || f.name.includes('個人情報')
        );
        console.log('🎯 検出された同意フィールド:', consentFields.map(f => ({
            name: f.name,
            type: f.type,
            required: f.required
        })));
        sendLog(`フォーム解析結果の全項目数: ${formAnalysisResult.fields ? formAnalysisResult.fields.length : 0}`, 'info');
        sendLog(`フォーム解析結果の構造: ${JSON.stringify(Object.keys(formAnalysisResult), null, 2)}`, 'info');
        
        // デバッグ: 必須項目の詳細をログ出力
        if (requiredFields.length > 0) {
            sendLog(`必須項目一覧: ${requiredFields.map(f => f.name).join(', ')}`, 'info');
        } else {
            sendLog('⚠️ 必須項目が見つかりません', 'warning');
            // 全項目の詳細をログ出力
            if (formAnalysisResult.fields && formAnalysisResult.fields.length > 0) {
                sendLog('全項目の詳細:', 'info');
                formAnalysisResult.fields.forEach((field, index) => {
                    sendLog(`  ${index + 1}. ${field.name} - ${field.required ? '必須' : '任意'} (${field.detectionMethod})`, 'info');
                });
            }
        }

        for (const field of requiredFields) {
            const mapping = {
                fieldName: field.name,
                fieldType: field.type,
                value: null,
                source: null,
                confidence: 0
            };

            // 同意項目の自動処理を最初にチェック（フィールド名による直接マッチング + JSONの設定）
            console.log(`🔎 フィールド処理開始: "${field.name}" (type: ${field.type})`);
            
            // 直接フィールド名マッチング（確実な処理のため）
            if (field.name === '登録内容に誤りはありません') {
                mapping.value = 'はい';
                mapping.source = '自動同意設定（直接マッチ）';
                mapping.confidence = 100;
                console.log(`✅ 直接マッチング成功: "${field.name}" → "はい"`);
            } else if (field.name === 'エージェント様の個人情報の取り扱いについて') {
                mapping.value = '同意します';
                mapping.source = '自動同意設定（直接マッチ）';
                mapping.confidence = 100;
                console.log(`✅ 直接マッチング成功: "${field.name}" → "同意します"`);
            } else if (field.name === '履歴書') {
                mapping.value = 'ー';
                mapping.source = '自動ファイル設定（直接マッチ）';
                mapping.confidence = 100;
                console.log(`✅ 直接マッチング成功: "${field.name}" → "ー" (ファイルアップロード前提)`);
            } else if (field.name === '現所属') {
                if (pdfResult.currentCompany && pdfResult.currentCompany.company) {
                    mapping.value = pdfResult.currentCompany.company;
                    mapping.source = '現所属自動抽出';
                    mapping.confidence = pdfResult.currentCompany.confidence;
                    console.log(`✅ 現所属マッピング成功: "${field.name}" → "${pdfResult.currentCompany.company}"`);
                } else {
                    console.log(`⚠️ 現所属の抽出に失敗: "${field.name}"`);
                }
            } else if (field.name === '最終学歴') {
                if (pdfResult.finalEducation && pdfResult.finalEducation.education) {
                    mapping.value = pdfResult.finalEducation.education;
                    mapping.source = '最終学歴自動抽出';
                    mapping.confidence = pdfResult.finalEducation.confidence;
                    console.log(`✅ 最終学歴マッピング成功: "${field.name}" → "${pdfResult.finalEducation.education}"`);
                } else {
                    console.log(`⚠️ 最終学歴の抽出に失敗: "${field.name}"`);
                }
            }
            
            // JSONファイルからの設定も確認（フォールバック）
            if (!mapping.value && extractionResult.autoConsentFields) {
                console.log(`🔍 同意項目チェック開始: フィールド名="${field.name}"`);
                console.log(`🔍 利用可能な同意設定:`, extractionResult.autoConsentFields);
                
                for (const [consentKey, consentValue] of Object.entries(extractionResult.autoConsentFields)) {
                    console.log(`  🔸 設定項目: "${consentKey}" = "${consentValue}"`);
                    
                    // より正確なマッチング条件
                    const isConsentMatch = 
                        field.name === consentKey ||  // 完全一致
                        (consentKey.includes('登録内容') && field.name.includes('登録内容')) ||
                        (consentKey.includes('個人情報') && field.name.includes('個人情報'));
                    
                    console.log(`  🔸 マッチ判定: ${isConsentMatch ? '✅' : '❌'} (フィールド: "${field.name}", 設定: "${consentKey}")`);
                    
                    if (isConsentMatch) {
                        mapping.value = consentValue;
                        mapping.source = '自動同意設定';
                        mapping.confidence = 100;
                        sendLog(`同意項目自動設定: ${field.name} = ${consentValue}`, 'info');
                        console.log(`✅ 同意項目マッピング成功: "${field.name}" → "${consentValue}"`);
                        break;
                    }
                }
            } else if (!mapping.value) {
                console.log(`⚠️ autoConsentFields が存在しません:`, extractionResult.autoConsentFields);
            }

            // 同意項目で値が設定されていない場合のみ、PDFデータからマッピング
            if (!mapping.value && (field.name.includes('氏名') || field.name.includes('名前') || field.name.includes('応募者氏名'))) {
                mapping.value = pdfResult.extractedName;
                mapping.source = 'PDF-simple-extractor';
                mapping.confidence = pdfResult.extractedName ? pdfResult.confidence : 0;
            } else if (!mapping.value && (field.name.includes('ふりがな') || field.name.includes('フリガナ'))) {
                mapping.value = pdfResult.furigana;
                mapping.source = 'PDF-simple-extractor';
                mapping.confidence = pdfResult.furigana ? Math.min(pdfResult.confidence, 90) : 0;
            } else if (!mapping.value && field.name.includes('年齢')) {
                mapping.value = pdfResult.age ? `${pdfResult.age}歳` : null;
                mapping.source = 'PDF-simple-extractor';
                mapping.confidence = pdfResult.age ? pdfResult.confidence : 0;
            } else if (!mapping.value && (field.name.includes('電話') || field.name.includes('TEL') || field.name.includes('電話番号'))) {
                mapping.value = pdfResult.phone;
                mapping.source = 'PDF-simple-extractor';
                mapping.confidence = pdfResult.phone ? pdfResult.confidence : 0;
            } else if (!mapping.value && (field.name.includes('メール') || field.name.includes('email') || field.name.includes('Email') || field.name.includes('メールアドレス'))) {
                mapping.value = pdfResult.email;
                mapping.source = 'PDF-simple-extractor';
                mapping.confidence = pdfResult.email ? pdfResult.confidence : 0;
            } else if (!mapping.value && field.name.includes('推薦') && field.name.includes('コメント')) {
                // 推薦時コメントはPDFからの抽出を優先（既存のRAコメント処理より上位）
                mapping.value = pdfResult.recommendationComment;
                mapping.source = 'PDF-simple-extractor';
                mapping.confidence = pdfResult.recommendationComment ? pdfResult.confidence : 0;
            } else if (!mapping.value && field.name === '経歴') {
                // 「経歴」フィールドのみにPDF解析結果をマッピング（職務経歴書は除外）
                mapping.value = pdfResult.careerSummary;
                mapping.source = 'PDF-simple-extractor';
                mapping.confidence = pdfResult.careerSummary ? pdfResult.confidence : 0;
                console.log(`✅ 経歴フィールドマッピング: "${field.name}" → PDF解析結果`);
            } else if (!mapping.value && field.name === '職務経歴書') {
                // 職務経歴書フィールドはファイルアップロード用なのでPDF解析結果をマッピングしない
                console.log(`⏭️ 職務経歴書フィールドスキップ: "${field.name}" (ファイルアップロード用)`);
            }

            // RAコメントからマッピング（年収関連）
            if (!mapping.value && field.name.includes('年収')) {
                const raComment = extractionResult.originalData || '';
                
                if (field.name.includes('現在') || field.name.includes('現年収')) {
                    const currentSalaryMatch = raComment.match(/現年収[：:\s]*(\d+)万円?/);
                    if (currentSalaryMatch) {
                        mapping.value = currentSalaryMatch[1] + '万円';
                        mapping.source = 'RAコメント';
                        mapping.confidence = 95;
                    }
                } else if (field.name.includes('希望') && !field.name.includes('最低')) {
                    const desiredSalaryMatch = raComment.match(/希望年収[：:\s]*(\d+)万円?/);
                    if (desiredSalaryMatch) {
                        mapping.value = desiredSalaryMatch[1] + '万円';
                        mapping.source = 'RAコメント';
                        mapping.confidence = 95;
                    }
                } else if (field.name.includes('最低')) {
                    const minSalaryMatch = raComment.match(/最低[希望]*年収[：:\s]*(\d+)万円?/);
                    if (minSalaryMatch) {
                        mapping.value = minSalaryMatch[1] + '万円';
                        mapping.source = 'RAコメント';
                        mapping.confidence = 95;
                    }
                }
            }

            // 推薦時コメント（PDFからの抽出が失敗した場合のフォールバック）
            if (!mapping.value && field.name.includes('推薦') && field.name.includes('コメント')) {
                const raComment = extractionResult.originalData || '';
                // 推薦理由セクションを抽出
                const recommendationMatch = raComment.match(/推薦理由[\s\S]*?(?=面談所感|転職理由|添付資料|$)/);
                if (recommendationMatch) {
                    mapping.value = recommendationMatch[0].replace(/推薦理由\s*/, '').trim();
                    mapping.source = 'RAコメント-fallback';
                    mapping.confidence = 80; // PDFより低い信頼度
                }
            }

            // その他希望条件（RAコメントの補足文言）
            if (!mapping.value && (field.name.includes('その他希望条件') || field.name.includes('備考'))) {
                const raComment = extractionResult.originalData || '';
                const noteMatch = raComment.match(/【(.+?)】/);
                if (noteMatch) {
                    mapping.value = noteMatch[1];
                    mapping.source = 'RAコメント';
                    mapping.confidence = 90;
                }
            }



            if (mapping.value && mapping.confidence > 0) {
                mappingResult.mappedFields++;
                mappingResult.mappings.push(mapping);
                sendLog(`マッピング成功: ${field.name} = ${mapping.value} (${mapping.source})`, 'info');
            } else {
                mappingResult.unmappedFields.push({
                    fieldName: field.name,
                    fieldType: field.type,
                    reason: 'PDFまたはRAコメントに対応するデータが見つかりません'
                });
                sendLog(`マッピング失敗: ${field.name} - データが見つかりません`, 'warning');
            }
        }

        // 必須項目のマッピング失敗チェック
        if (mappingResult.unmappedFields.length > 0) {
            sendLog(`🔍 マッピング失敗項目チェック: ${mappingResult.unmappedFields.length}個`, 'info');
            mappingResult.unmappedFields.forEach((field, index) => {
                sendLog(`🔍 失敗項目${index + 1}: ${JSON.stringify(field)}`, 'info');
            });
            
            const unmappedRequiredFields = mappingResult.unmappedFields.filter(field => 
                field && field.fieldName && typeof field.fieldName === 'string'
            );
            
            sendLog(`🔍 フィルタ後必須項目: ${unmappedRequiredFields.length}個`, 'info');
            unmappedRequiredFields.forEach((field, index) => {
                sendLog(`🔍 必須項目${index + 1}: ${field.fieldName}`, 'info');
            });
            
            // 🚨 1つでもマッピング失敗項目があれば処理を停止
            if (unmappedRequiredFields.length > 0) {
                sendLog(`🚨 必須項目のマッピングに失敗しました: ${unmappedRequiredFields.map(f => f.fieldName).join(', ')}`, 'error');
                return {
                    success: false,
                    error: `必須項目のマッピングに失敗: ${unmappedRequiredFields.map(f => f.fieldName).join(', ')}`,
                    mappedFields: mappingResult.mappedFields,
                    mappings: mappingResult.mappings,
                    unmappedFields: mappingResult.unmappedFields,
                    criticalError: true
                };
            }
        }

        // 🚨 最終チェック: unmappedFieldsがある場合はsuccess: falseを返す
        if (mappingResult.unmappedFields && mappingResult.unmappedFields.length > 0) {
            sendLog(`🚨 最終チェック: ${mappingResult.unmappedFields.length}個のマッピング失敗項目を検出`, 'error');
            return {
                success: false,
                error: `必須項目のマッピングに失敗: ${mappingResult.unmappedFields.map(f => f.fieldName).join(', ')}`,
                mappedFields: mappingResult.mappedFields,
                mappings: mappingResult.mappings,
                unmappedFields: mappingResult.unmappedFields,
                criticalError: true
            };
        }

        return mappingResult;

    } catch (error) {
        return {
            success: false,
            error: error.message,
            mappedFields: 0,
            mappings: [],
            unmappedFields: []
        };
    }
}

// 拡張JSONを生成する関数
async function generateEnhancedJson(originalJson, pdfResult, mappingResult, jobName) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sanitizedJobName = jobName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
        const fileName = `enhanced_${sanitizedJobName}_${timestamp}.json`;
        const filePath = path.join(__dirname, 'output/success', fileName);

        // ディレクトリが存在しない場合は作成
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const enhancedData = {
            metadata: {
                originalJsonFile: originalJson,
                pdfAnalysisResult: {
                    extractionMethod: pdfResult.method || 'pdf-parse-simple',
                    extractedName: pdfResult.extractedName,
                    furigana: pdfResult.furigana,
                    age: pdfResult.age,
                    phone: pdfResult.phone,
                    email: pdfResult.email,
                    recommendationComment: pdfResult.recommendationComment,
                    careerSummary: pdfResult.careerSummary,
                    confidence: pdfResult.confidence
                },
                mappingResult: {
                    mappedFields: mappingResult.mappedFields,
                    totalRequiredFields: mappingResult.mappings.length + mappingResult.unmappedFields.length
                },
                generatedAt: new Date().toISOString(),
                targetJob: jobName
            },
            formData: {},
            unmappedRequiredFields: mappingResult.unmappedFields
        };

        // マッピングされたデータを追加
        mappingResult.mappings.forEach(mapping => {
            enhancedData.formData[mapping.fieldName] = {
                value: mapping.value,
                source: mapping.source,
                confidence: mapping.confidence
            };
        });

        // ファイルに保存
        fs.writeFileSync(filePath, JSON.stringify(enhancedData, null, 2), 'utf8');
        
        sendLog(`拡張JSONを保存しました: ${fileName}`, 'success');

        return {
            success: true,
            filePath: filePath,
            fileName: fileName,
            data: enhancedData
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    sseClients.push(res);
    
    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

function sendEvent(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => client.write(message));
}

function sendLog(message, level = 'info') {
    sendEvent({ type: 'log', message, level });
}

app.post('/upload', upload.single('jsonFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'JSONファイルがアップロードされていません' });
    }
    
    try {
        const jsonData = fs.readFileSync(req.file.path, 'utf8');
        const parsedData = JSON.parse(jsonData);
        
        fs.unlinkSync(req.file.path);
        
        res.json({ 
            message: 'JSONファイルが正常にアップロードされました',
            data: parsedData 
        });
    } catch (error) {
        res.status(400).json({ error: 'JSONファイルの解析に失敗しました' });
    }
});

// 新しいexecuteエンドポイント（JSONとPDFファイルを受け取る）
app.post('/execute', upload.fields([
    { name: 'jsonFile', maxCount: 1 },
    { name: 'pdfFile', maxCount: 1 }
]), async (req, res) => {
    try {
        // ファイルの存在確認
        if (!req.files || !req.files.jsonFile || !req.files.pdfFile) {
            sendLog('JSONファイルとPDFファイルの両方が必要です', 'error');
            return res.status(400).json({ error: 'JSONファイルとPDFファイルの両方が必要です' });
        }

        const jsonFile = req.files.jsonFile[0];
        const pdfFile = req.files.pdfFile[0];

        // JSONファイルを読み込み（エラーハンドリング強化）
        sendLog('JSONファイルを読み込んでいます...');
        let jsonData;
        try {
            const jsonContent = fs.readFileSync(jsonFile.path, 'utf8');
            if (!jsonContent || jsonContent.trim().length === 0) {
                throw new Error('JSONファイルが空です');
            }
            jsonData = JSON.parse(jsonContent);
            if (!jsonData || typeof jsonData !== 'object') {
                throw new Error('無効なJSONデータ形式です');
            }
            sendLog('JSONファイルの読み込みが完了しました', 'success');
        } catch (parseError) {
            sendLog(`JSONファイルの読み込みエラー: ${parseError.message}`, 'error');
            throw new Error(`JSONファイルの解析に失敗しました: ${parseError.message}`);
        }
        
        // PDFファイルを解析（エラーハンドリング強化）
        sendLog('PDFファイルを解析しています...');
        
        // PDFファイルの存在・アクセス性確認
        if (!fs.existsSync(pdfFile.path)) {
            throw new Error(`PDFファイルが見つかりません: ${pdfFile.path}`);
        }
        
        const pdfStats = fs.statSync(pdfFile.path);
        if (pdfStats.size === 0) {
            throw new Error('PDFファイルが空です');
        }
        
        sendLog(`PDFファイルサイズ: ${Math.round(pdfStats.size / 1024)}KB`);
        
        const simplePDFExtractor = new SimplePDFExtractor();
        simplePDFExtractor.debug = true;
        
        let pdfResult;
        try {
            pdfResult = await simplePDFExtractor.extractTextFromPDF(pdfFile.path);
        } catch (pdfError) {
            sendLog(`PDF抽出器エラー: ${pdfError.message}`, 'error');
            throw new Error(`PDF解析に失敗しました: ${pdfError.message}`);
        }
        
        if (pdfResult.success) {
            const extractedItems = [];
            if (pdfResult.extractedName) extractedItems.push(`氏名「${pdfResult.extractedName}」`);
            if (pdfResult.furigana) extractedItems.push(`ふりがな「${pdfResult.furigana}」`);
            if (pdfResult.age) extractedItems.push(`年齢「${pdfResult.age}歳」`);
            if (pdfResult.phone) extractedItems.push(`電話「${pdfResult.phone}」`);
            if (pdfResult.email) extractedItems.push(`メール「${pdfResult.email}」`);
            
            if (extractedItems.length > 0) {
                sendLog(`PDF解析完了: ${extractedItems.join(', ')}を抽出しました`);
            } else {
                sendLog('PDF解析完了: データが抽出されませんでした', 'warning');
            }
        } else {
            sendLog(`PDF解析エラー: ${pdfResult.error}`, 'error');
        }

        // 新しい抽出機能を使用
        sendLog('求人名の抽出を開始しています...');
        const extractionResult = extractJobNameFromComplexFormat(jsonData);
        
        if (!extractionResult.success) {
            sendLog(`求人名の抽出に失敗しました: ${extractionResult.errors.join(', ')}`, 'error');
            return res.status(400).json({ 
                error: '求人名の抽出に失敗しました',
                details: extractionResult.errors 
            });
        }

        const inputJobName = extractionResult.extractedName;
        sendLog(`抽出された求人名: ${inputJobName} (信頼度: ${extractionResult.confidence}%, 方法: ${extractionResult.method})`);
        
        // 🔍 求人名デバッグ: 詳細ログ出力
        sendLog(`🔍 求人名デバッグ: "${inputJobName}" (型: ${typeof inputJobName}, 長さ: ${inputJobName?.length || 'N/A'})`, 'info');
        
        // 信頼度チェック
        if (extractionResult.confidence < SAFETY_CONFIG.MINIMUM_CONFIDENCE_THRESHOLD) {
            sendLog(`信頼度が不足しています (${extractionResult.confidence}% < ${SAFETY_CONFIG.MINIMUM_CONFIDENCE_THRESHOLD}%)`, 'error');
            return res.status(400).json({ 
                error: '抽出の信頼度が不足しています',
                confidence: extractionResult.confidence,
                threshold: SAFETY_CONFIG.MINIMUM_CONFIDENCE_THRESHOLD
            });
        }

        // 警告がある場合は表示
        if (extractionResult.warnings.length > 0) {
            extractionResult.warnings.forEach(warning => {
                sendLog(`警告: ${warning}`, 'warning');
            });
        }

        sendLog('ブラウザを起動しています...');
        
        // 既存ブラウザの安全な終了
        if (browser) {
            try {
                await browser.close();
                sendLog('既存ブラウザを終了しました');
            } catch (closeError) {
                sendLog(`ブラウザ終了エラー: ${closeError.message}`, 'warning');
            }
            browser = null;
            page = null;
        }
        
        // ブラウザの起動（タイムアウト設定あり）
        try {
            browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
                timeout: 30000
            });
            sendLog('ブラウザの起動が完了しました', 'success');
        } catch (launchError) {
            sendLog(`ブラウザ起動エラー: ${launchError.message}`, 'error');
            throw new Error(`ブラウザの起動に失敗しました: ${launchError.message}`);
        }
        
        sendLog('新しいページを作成しています...');
        try {
            page = await browser.newPage();
            
            // ページのエラーハンドリング設定
            page.on('error', (error) => {
                sendLog(`ページエラー: ${error.message}`, 'error');
            });
            
            page.on('pageerror', (error) => {
                sendLog(`ページJavaScriptエラー: ${error.message}`, 'warning');
            });
            
            sendLog('新しいページの作成が完了しました', 'success');
        } catch (pageError) {
            throw new Error(`ページ作成エラー: ${pageError.message}`);
        }
        
        sendLog('指定のURLにアクセスしています...');
        try {
            await page.goto('https://agent.herp.cloud/p/HO3nC9noAkwOgXlKbC-hDeewP8nK4yQlrT2OnkN2XTw', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            sendLog('ページの読み込みが完了しました', 'success');
        } catch (navigationError) {
            sendLog(`ページナビゲーションエラー: ${navigationError.message}`, 'error');
            throw new Error(`ページの読み込みに失敗しました: ${navigationError.message}`);
        }
        
        sendLog('ページの読み込みが完了しました', 'success');
        
        sendLog('募集職種一覧を取得しています...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 「この職種に推薦する」ボタンと対応する求人名のみを取得
        const jobListings = await page.evaluate(() => {
            const jobs = [];
            
            // 「この職種に推薦する」ボタンを含む要素を探す
            const recommendationButtons = document.querySelectorAll('button');
            const validButtons = Array.from(recommendationButtons).filter(btn => 
                btn.textContent && btn.textContent.includes('この職種に推薦する')
            );
            
            console.log(`推薦ボタンを${validButtons.length}個見つけました`);
            
            validButtons.forEach((button) => {
                // ボタンの親要素から対応する求人名を探す
                let currentElement = button;
                let jobName = null;
                
                // 上位の要素を辿って求人名を探す
                for (let i = 0; i < 10; i++) {
                    currentElement = currentElement.parentElement;
                    if (!currentElement) break;
                    
                    // 求人名が含まれていそうなセルを探す
                    const nameCell = currentElement.querySelector('.agent-requisitions-table-list__cell.--name');
                    if (nameCell) {
                        const anchor = nameCell.querySelector('a');
                        if (anchor && anchor.textContent) {
                            jobName = anchor.textContent.trim();
                            break;
                        }
                    }
                    
                    // 別の方法：テーブル行の最初の列を探す
                    const firstCell = currentElement.querySelector('td:first-child');
                    if (firstCell) {
                        const anchor = firstCell.querySelector('a');
                        if (anchor && anchor.textContent) {
                            jobName = anchor.textContent.trim();
                            break;
                        }
                    }
                }
                
                if (jobName && !jobs.includes(jobName)) {
                    jobs.push(jobName);
                }
            });
            
            return jobs;
        });
        
        sendLog(`${jobListings.length}件の募集職種を取得しました`);
        sendLog('募集職種一覧: ' + jobListings.join(', '));
        
        sendLog(`安全なマッチング処理を開始: ${inputJobName}`);
        
        // 新しい安全なマッチング機能を使用
        const matchResult = safeJobMatching(inputJobName, jobListings);
        
        if (!matchResult.success) {
            sendLog(`マッチングに失敗しました: ${matchResult.errors.join(', ')}`, 'error');
            
            // 🚨 求人マッチング失敗時の自動停止
            const errorMessage = `求人マッチングに失敗しました。\n\n原因: ${matchResult.errors.join(', ')}\n\n入力求人名: "${inputJobName}"\n利用可能な求人: ${jobListings.length}件`;
            
            const result = {
                inputJobName,
                extractionDetails: extractionResult,
                matchedJob: null,
                matchType: 'none',
                confidence: 0,
                availableJobs: jobListings,
                errors: matchResult.errors,
                alternatives: matchResult.alternatives,
                criticalError: true,
                errorType: 'job_matching_failed',
                errorMessage: errorMessage,
                stopReason: '求人マッチング失敗'
            };
            
            sendEvent({ type: 'result', result });
            sendLog('🚨 求人マッチング失敗により処理を停止します', 'error');
            sendEvent({ type: 'complete' });
            
            return res.json({ 
                message: '求人マッチングに失敗しました',
                result 
            });
        }

        // 成功した場合 - ボタンクリック処理を追加
        sendLog(`${matchResult.matchType === 'exact' ? '完全' : '部分'}一致: ${inputJobName} → ${matchResult.matchedJob} (信頼度: ${matchResult.confidence}%)`, 'success');
        
        // 🔍 求人名整合性チェック
        if (inputJobName !== extractionResult.extractedName) {
            sendLog(`⚠️ 求人名の不整合を検出: "${inputJobName}" ≠ "${extractionResult.extractedName}"`, 'warning');
        }
        
        // マッチした求人に対応するボタンをクリック
        sendLog('対応する「この職種に推薦する」ボタンを検索しています...');
        
        const clickResult = await clickRecommendationButton(page, matchResult.matchedJob);
        
        let formAnalysisResult = null;
        
        // ボタンクリックが成功した場合、フォーム解析と自動入力を実行
        if (clickResult.success) {
            sendLog('推薦ページのフォーム項目を解析しています...', 'info');
            
            // ページ遷移を待機
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // JSON指定項目とRAコメント項目を分離
            const jsonRequiredFields = extractionResult.additionalRequiredFields.filter(field => 
                !extractionResult.raCommentFields.includes(field)
            );
            
            formAnalysisResult = await analyzeRecommendationForm(
                page, 
                matchResult.matchedJob, 
                jsonRequiredFields,
                extractionResult.raCommentFields,
                extractionResult.autoConsentFields
            );
            
            if (formAnalysisResult.success) {
                sendLog(`フォーム解析完了: ${formAnalysisResult.totalFields}個の項目を検出`, 'success');
                
                // 結果をファイルに保存
                const savedFile = await saveFormAnalysisToFile(formAnalysisResult, matchResult.matchedJob);
                formAnalysisResult.savedFile = savedFile;
                
                // PDF解析結果と必須項目をマッピング
                sendLog('PDF解析結果と必須項目をマッピングしています...', 'info');
                const mappingResult = await mapPdfDataToRequiredFields(
                    formAnalysisResult, 
                    pdfResult, 
                    extractionResult
                );
                
                // 🔍 マッピング結果の詳細デバッグ
                sendLog(`🔍 マッピング結果: success=${mappingResult.success}, criticalError=${mappingResult.criticalError}`, 'info');
                sendLog(`🔍 マッピング結果詳細: ${JSON.stringify({
                    success: mappingResult.success,
                    mappedFields: mappingResult.mappedFields,
                    unmappedFieldsCount: mappingResult.unmappedFields?.length || 0,
                    criticalError: mappingResult.criticalError,
                    error: mappingResult.error
                })}`, 'info');
                
                // 🚨 マッピング失敗の場合は即座に停止
                if (!mappingResult.success) {
                    sendLog('🚨 マッピング失敗により処理を停止します', 'error');
                    const result = {
                        inputJobName,
                        extractionDetails: extractionResult,
                        jobMatching: matchResult,
                        matchedJob: matchResult.matchedJob,
                        matchType: matchResult.matchType,
                        formAnalysis: formAnalysisResult,
                        mappingResult: mappingResult,
                        success: false,
                        error: mappingResult.error,
                        criticalError: true,
                        errorType: 'required_field_mapping_failed',
                        errorMessage: mappingResult.error,
                        stopReason: '必須項目マッピング失敗'
                    };
                    
                    sendEvent({ type: 'result', result });
                    sendLog('🚨 必須項目マッピング失敗により処理を停止します', 'error');
                    sendEvent({ type: 'complete' });
                    
                    res.json({ 
                        message: '必須項目マッピングに失敗しました',
                        result 
                    });
                    await browser.close();
                    return;
                }
                
                if (mappingResult.success) {
                    sendLog(`データマッピング完了: ${mappingResult.mappedFields}個の項目をマッピング`, 'success');
                    
                    // 🔍 自動停止チェック用デバッグ
                    sendLog(`🔍 自動停止チェック: unmappedFields=${mappingResult.unmappedFields?.length || 0}個`, 'info');
                    if (mappingResult.unmappedFields && mappingResult.unmappedFields.length > 0) {
                        sendLog(`🔍 マッピング失敗項目: ${mappingResult.unmappedFields.map(f => f.fieldName).join(', ')}`, 'warning');
                    }
                    
                    // 🚨 マッピング失敗項目がある場合は自動停止
                    if (mappingResult.unmappedFields && mappingResult.unmappedFields.length > 0) {
                        const unmappedFieldNames = mappingResult.unmappedFields.map(field => field.fieldName || field).join('\n- ');
                        const errorMessage = `必須項目のマッピングに失敗しました。\n\nマッピング失敗項目: ${mappingResult.unmappedFields.length}件\n- ${unmappedFieldNames}\n\n全ての必須項目が正しくマッピングされるまで処理を停止します。`;
                        
                        sendLog('🚨 必須項目のマッピング失敗により処理を停止します', 'error');
                        formAnalysisResult.criticalError = true;
                        formAnalysisResult.errorMessage = errorMessage;
                        formAnalysisResult.dataMapping = mappingResult;
                        
                        const result = {
                            inputJobName,
                            extractionDetails: extractionResult,
                            jobMatching: matchResult,
                            matchedJob: matchResult.matchedJob,
                            matchType: matchResult.matchType,
                            formAnalysis: formAnalysisResult,
                            mappingResult: mappingResult,
                            success: false,
                            error: '必須項目マッピング失敗',
                            criticalError: true,
                            errorType: 'required_field_mapping_failed',
                            errorMessage: errorMessage,
                            stopReason: '必須項目マッピング失敗',
                            unmappedFields: unmappedFieldNames
                        };
                        
                        sendEvent({ type: 'result', result });
                        sendLog('🚨 必須項目マッピング失敗により処理を停止します', 'error');
                        sendEvent({ type: 'complete' });
                        
                        res.json({ 
                            message: '必須項目マッピングに失敗しました',
                            result 
                        });
                        await browser.close();
                        return;
                    }
                    
                    // フォーム自動入力はHERPに対して実行しないため削除
                    sendLog('データマッピングが完了しました。フォーム自動入力は実行しません（HERPサイトへの直接入力は行いません）', 'info');
                    
                    // 拡張JSONを生成
                    // 🔍 拡張JSON生成前の求人名デバッグ
                    sendLog(`🔍 拡張JSON生成前デバッグ: inputJobName="${inputJobName}", matchedJob="${matchResult.matchedJob}"`, 'info');
                    
                    const enhancedJson = await generateEnhancedJson(
                        jsonData, 
                        pdfResult, 
                        mappingResult, 
                        matchResult.matchedJob
                    );
                    
                    // フロントエンド用のpdfAnalysis構造に変換
                    formAnalysisResult.pdfAnalysis = {
                        method: pdfResult.method || 'pdf-parse-simple',
                        extractedName: pdfResult.extractedName,
                        furigana: pdfResult.furigana,
                        age: pdfResult.age,
                        phone: pdfResult.phone,
                        email: pdfResult.email,
                        recommendationComment: pdfResult.recommendationComment,
                        careerSummary: pdfResult.careerSummary,
                        confidence: pdfResult.confidence
                    };
                    formAnalysisResult.dataMapping = mappingResult;
                    formAnalysisResult.enhancedJson = enhancedJson;
                } else {
                    sendLog(`データマッピングに失敗: ${mappingResult.error}`, 'error');
                    
                    // 必須項目のマッピング失敗の場合は処理を停止
                    if (mappingResult.criticalError || (mappingResult.unmappedFields && mappingResult.unmappedFields.length > 0)) {
                        // 🚨 必須項目マッピング失敗時の自動停止
                        const unmappedFields = mappingResult.unmappedFields || [];
                        const unmappedFieldNames = unmappedFields.map(field => field.fieldName || field).join('\n- ');
                        const errorMessage = `必須項目のマッピングに失敗しました。\n\nマッピング失敗項目: ${unmappedFields.length}件\n- ${unmappedFieldNames}\n\nエラー詳細: ${mappingResult.error}`;
                        
                        sendLog('🚨 必須項目のマッピング失敗により処理を停止します', 'error');
                        formAnalysisResult.criticalError = true;
                        formAnalysisResult.errorMessage = errorMessage;
                        formAnalysisResult.dataMapping = mappingResult;
                        
                        // ここで処理を停止（拡張JSON生成などは実行しない）
                        // 🔍 最終的な求人名デバッグ
                        sendLog(`🔍 最終求人名デバッグ: "${inputJobName}" (型: ${typeof inputJobName})`, 'info');
                        
                        const result = {
                            inputJobName,
                            extractionDetails: extractionResult,
                            jobMatching: matchResult,
                            matchedJob: matchResult.matchedJob,
                            matchType: matchResult.matchType,
                            formAnalysis: formAnalysisResult,
                            mappingResult: mappingResult,
                            success: false,
                            error: mappingResult.error,
                            criticalError: true,
                            errorType: 'required_field_mapping_failed',
                            errorMessage: errorMessage,
                            stopReason: '必須項目マッピング失敗',
                            unmappedFields: unmappedFieldNames
                        };
                        
                        sendEvent({ type: 'result', result });
                        sendLog('🚨 必須項目マッピング失敗により処理を停止します', 'error');
                        sendEvent({ type: 'complete' });
                        
                        res.json({ 
                            message: '必須項目マッピングに失敗しました',
                            result 
                        });
                        await browser.close();
                        return;
                    }
                }
            } else {
                sendLog(`フォーム解析に失敗: ${formAnalysisResult.error}`, 'error');
            }
        }
        
        // 🔍 最終結果生成前の求人名デバッグ
        sendLog(`🔍 最終結果生成前デバッグ: inputJobName="${inputJobName}" (型: ${typeof inputJobName})`, 'info');
        
        const result = {
            inputJobName,
            extractionDetails: extractionResult,
            matchedJob: matchResult.matchedJob,
            matchType: matchResult.matchType,
            confidence: matchResult.confidence,
            availableJobs: jobListings,
            warnings: matchResult.warnings,
            buttonClicked: clickResult.success,
            clickDetails: clickResult,
            formAnalysis: formAnalysisResult,
            mappingResult: formAnalysisResult.dataMapping || null  // マッピング結果を含める
        };
        
        sendEvent({ type: 'result', result });
        
        if (clickResult.success) {
            sendLog('「この職種に推薦する」ボタンのクリックが完了しました', 'success');
        } else {
            sendLog(`ボタンクリックに失敗しました: ${clickResult.error}`, 'error');
        }
        
        sendLog('判定処理が完了しました', 'success');
        sendEvent({ type: 'complete' });
        
        res.json({ 
            message: '判定が完了しました',
            result 
        });
        
    } catch (error) {
        console.error('Error:', error);
        sendLog(`エラーが発生しました: ${error.message}`, 'error');
        
        // ブラウザの安全なクリーンアップ
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('ブラウザクリーンアップエラー:', closeError.message);
            }
            browser = null;
            page = null;
        }
        
        res.status(500).json({ error: 'ブラウザの起動に失敗しました: ' + error.message });
    }
});

// HERP自動転記エンドポイント（multer設定修正）
app.post('/herp-register', upload.single('pdfFile'), async (req, res) => {
    try {
        console.log('🔍 /herp-register エンドポイントが呼び出されました');
        console.log('Request headers:', req.headers);
        console.log('Request body:', req.body);
        console.log('Request file:', req.file);
        
        // enhancedDataの取得（FormDataで文字列として送信される）
        const enhancedDataString = req.body.enhancedData;
        if (!enhancedDataString) {
            sendLog('Enhanced JSONデータが要求で見つかりません', 'error');
            console.log('❌ req.body:', req.body);
            console.log('❌ req.file:', req.file);
            return res.status(400).json({ error: 'Enhanced JSONデータが見つかりません' });
        }

        let enhancedData;
        try {
            enhancedData = JSON.parse(enhancedDataString);
        } catch (parseError) {
            sendLog(`Enhanced JSONデータのパースエラー: ${parseError.message}`, 'error');
            return res.status(400).json({ error: `Enhanced JSONデータの解析に失敗しました: ${parseError.message}` });
        }
        
        const pdfFile = req.file;

        if (!pdfFile) {
            return res.status(400).json({ error: '履歴書PDFファイルが見つかりません' });
        }

        sendLog('HERP自動転記を開始します...', 'info');
        sendLog(`転記項目数: ${Object.keys(enhancedData.formData).length}個`, 'info');

        // 現在のページがHERPの推薦フォームかチェック
        if (!page || !browser) {
            return res.status(400).json({ error: 'ブラウザが起動していません。先に実行ボタンを押してください。' });
        }

        const currentUrl = await page.url();
        if (!currentUrl.includes('herp.cloud')) {
            return res.status(400).json({ error: 'HERPページが開かれていません。先に実行ボタンを押してマッチングを完了してください。' });
        }

        sendLog('HERPフォームが検出されました。自動転記を開始します...', 'info');

        // フォーム転記を実行
        const fillResult = await fillHerpForm(page, enhancedData, pdfFile);

        if (fillResult.success) {
            sendLog(`✅ HERP転記完了: ${fillResult.filledFields}個の項目を転記`, 'success');
            res.json({
                message: 'HERP転記が完了しました',
                filledFields: fillResult.filledFields,
                details: fillResult.details
            });
        } else {
            sendLog(`❌ HERP転記失敗: ${fillResult.error}`, 'error');
            res.status(500).json({
                error: 'HERP転記に失敗しました',
                details: fillResult.error
            });
        }

    } catch (error) {
        console.error('HERP転記エラー:', error);
        sendLog(`❌ HERP転記エラー: ${error.message}`, 'error');
        
        // スタックトレースをログに記録（デバッグ用）
        console.error('Stack trace:', error.stack);
        
        // エラーレスポンスをJSONで返す
        res.status(500).json({ 
            error: 'HERP転記中にエラーが発生しました',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// エラーチェックエンドポイント
app.post('/error-check', upload.none(), async (req, res) => {
    try {
        const enhancedDataString = req.body.enhancedData;
        if (!enhancedDataString) {
            sendLog('Enhanced JSONデータが要求で見つかりません', 'error');
            return res.status(400).json({ error: 'Enhanced JSONデータが見つかりません' });
        }

        let enhancedData;
        try {
            enhancedData = JSON.parse(enhancedDataString);
        } catch (parseError) {
            sendLog(`Enhanced JSONデータのパースエラー: ${parseError.message}`, 'error');
            return res.status(400).json({ error: `Enhanced JSONデータの解析に失敗しました: ${parseError.message}` });
        }

        // 現在のページがHERPの推薦フォームかチェック
        if (!page || !browser) {
            return res.status(400).json({ error: 'ブラウザが起動していません。' });
        }

        const currentUrl = await page.url();
        if (!currentUrl.includes('herp.cloud')) {
            return res.status(400).json({ error: 'HERPページが開かれていません。' });
        }

        sendLog('転記データのチェックを開始しています...', 'info');
        
        // 🔍 エラーチェック時の求人名デバッグ
        const checkJobName = enhancedData?.inputJobName || 'undefined';
        sendLog(`🔍 エラーチェック時デバッグ: checkJobName="${checkJobName}" (型: ${typeof checkJobName})`, 'info');

        // データ検証の実行
        const checkResult = await verifyHerpFormData(page, enhancedData);

        if (checkResult.hasErrors) {
            // 🚨 エラーチェックで不一致検出時の自動停止
            const errorMessage = `データの不一致が検出されました。\n\n不一致項目: ${checkResult.errors.length}件\n${checkResult.errors.map(error => `- ${error.field}: ${error.message}`).join('\n')}\n\n全ての項目が正しく転記されるまで処理を停止します。`;
            
            sendLog(`❌ エラーが検出されました: ${checkResult.errors.length}件の不一致`, 'error');
            sendLog('🚨 データ不一致により処理を停止します', 'error');
            
            res.json({
                hasErrors: true,
                errors: checkResult.errors,
                checkedFields: checkResult.checkedFields,
                message: 'データの不一致が検出されました',
                criticalError: true,
                errorType: 'data_validation_failed',
                errorMessage: errorMessage,
                stopReason: 'データ不一致検出'
            });
        } else {
            sendLog('✅ エラーチェック完了: 全ての項目が正しく転記されています', 'success');
            res.json({
                hasErrors: false,
                errors: [],
                checkedFields: checkResult.checkedFields,
                message: '全ての項目が正しく転記されています'
            });
        }

    } catch (error) {
        console.error('エラーチェックエラー:', error);
        sendLog(`❌ エラーチェックエラー: ${error.message}`, 'error');
        res.status(500).json({ 
            error: 'エラーチェック中にエラーが発生しました',
            details: error.message
        });
    }
});

app.post('/close', async (_, res) => {
    try {
        if (browser) {
            await browser.close();
            browser = null;
            page = null;
            sendLog('ブラウザを終了しました');
        }
        res.json({ message: 'ブラウザを閉じました' });
    } catch (error) {
        res.status(500).json({ error: 'ブラウザの終了に失敗しました' });
    }
});

app.listen(port, () => {
    console.log(`RPAツールが http://localhost:${port} で起動しました`);
});

process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});

// HERPフォーム自動転記機能
async function fillHerpForm(page, enhancedData, pdfFile) {
    const fillResult = {
        success: false,
        filledFields: 0,
        details: [],
        error: null
    };

    try {
        sendLog('HERPフォームの項目を検索しています...', 'info');

        // HERPフォームのフィールドマッピング定義
        const fieldMappings = {
            // テキスト入力フィールド
            '応募者氏名': 'input.text-field__input[placeholder*="採用 太郎"]',
            '現所属': 'input.text-field__input[placeholder*="株式会社HERP"]',
            '年齢': 'input.text-field__input[placeholder*="27"]',
            '最終学歴': 'input.text-field__input[placeholder*="大学人事学部採用学科"]',
            '電話番号': 'input.text-field__input[placeholder*="080-1234-5678"]',
            'メールアドレス': 'input.text-field__input[placeholder*="herp@herp.co.jp"]',
            
            // 年収フィールド（数値のみ）
            '現年収': 'input.text-field__input[placeholder*="500"]',
            '希望年収': 'input.text-field__input[placeholder*="600"]',
            '希望年収（最低）': 'input.text-field__input[placeholder*="400"]',
            
            // テキストエリア
            '推薦時コメント': 'textarea.multiline-text-field__input[placeholder*="先月まで株式会社"]',
            '経歴': 'textarea.multiline-text-field__input[placeholder*="大学卒業後"]',
            'その他希望条件': 'textarea.multiline-text-field__input[placeholder*="ストックオプション"]',
            
            // リンクフィールド
            'リンク1': 'input.text-field__input[placeholder*="github.com/xxx"][data-index="0"]',
            'リンク2': 'input.text-field__input[placeholder*="github.com/xxx"][data-index="1"]'
        };

        sendLog(`Enhanced JSONから${Object.keys(enhancedData.formData).length}個の転記可能項目を検出`, 'info');

        // データの存在確認
        if (!enhancedData || !enhancedData.formData || typeof enhancedData.formData !== 'object') {
            throw new Error('Enhanced data の formData が無効です');
        }
        
        // 各フィールドを転記
        for (const [fieldName, fieldData] of Object.entries(enhancedData.formData)) {
            // フィールドデータの検証
            if (!fieldData || typeof fieldData !== 'object') {
                sendLog(`⚠️ フィールド「${fieldName}」のデータが無効です`, 'warning');
                continue;
            }
            
            try {
                const selector = fieldMappings[fieldName];
                if (!selector) {
                    sendLog(`⚠️ フィールド「${fieldName}」のセレクターが見つかりません`, 'warning');
                    continue;
                }

                // フィールドの存在確認
                const fieldExists = await page.$(selector);
                if (!fieldExists) {
                    sendLog(`⚠️ フィールド「${fieldName}」がページに存在しません (${selector})`, 'warning');
                    continue;
                }

                let valueToFill = fieldData.value;

                // 年収フィールドの場合は数値のみを抽出
                if (fieldName.includes('年収') && typeof valueToFill === 'string') {
                    const numericMatch = valueToFill.match(/(\d+)/);
                    if (numericMatch) {
                        valueToFill = numericMatch[1];
                    }
                }

                // フィールドに値を入力（エラーハンドリング強化）
                await page.focus(selector);
                await page.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    if (element) element.value = '';
                }, selector);
                
                // 値が文字列でない場合は文字列に変換
                const stringValue = String(valueToFill || '');
                if (stringValue.length === 0) {
                    sendLog(`⚠️ フィールド「${fieldName}」の値が空です`, 'warning');
                    continue;
                }
                
                await page.type(selector, stringValue);
                
                // 入力値の検証
                const actualValue = await page.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    return element ? element.value : null;
                }, selector);
                
                if (actualValue !== stringValue) {
                    sendLog(`⚠️ フィールド「${fieldName}」の入力値が期待と異なります (期待: "${stringValue}", 実際: "${actualValue}")`, 'warning');
                }

                fillResult.filledFields++;
                fillResult.details.push({
                    fieldName: fieldName,
                    value: valueToFill,
                    source: fieldData.source,
                    confidence: fieldData.confidence
                });

                sendLog(`✅ 転記完了: ${fieldName} = "${valueToFill}" (${fieldData.source})`, 'info');
                
                // 少し待機（ページの反応を待つ）
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                sendLog(`❌ フィールド「${fieldName}」の転記エラー: ${error.message}`, 'error');
                fillResult.details.push({
                    fieldName: fieldName,
                    value: 'エラー',
                    source: 'エラー',
                    confidence: 0,
                    error: error.message
                });
            }
        }

        // 履歴書PDFファイルのアップロード
        sendLog('履歴書PDFファイルをアップロードしています...', 'info');
        try {
            // PDFファイルの存在確認
            if (!pdfFile || !pdfFile.path || !fs.existsSync(pdfFile.path)) {
                throw new Error('アップロード用PDFファイルが見つかりません');
            }
            
            const resumeFileSelector = 'input[type="file"]';
            const resumeFileInput = await page.$(resumeFileSelector);
            
            if (resumeFileInput) {
                await resumeFileInput.uploadFile(pdfFile.path);
                sendLog('✅ 履歴書PDFのアップロードが完了しました', 'success');
                fillResult.details.push({
                    fieldName: '履歴書',
                    value: pdfFile.originalname,
                    source: 'ファイルアップロード',
                    confidence: 100
                });
            } else {
                sendLog('⚠️ 履歴書ファイルアップロード欄が見つかりません', 'warning');
            }
        } catch (error) {
            sendLog(`❌ 履歴書アップロードエラー: ${error.message}`, 'error');
        }

        // チェックボックスの自動チェック（改善版）
        sendLog('最終チェックボックスを確認しています...', 'info');
        try {
            // ページ内の全チェックボックスを詳細に解析
            await page.waitForSelector('input[type="checkbox"]', { timeout: 8000 });
            
            const checkboxAnalysis = await page.evaluate(() => {
                const checkboxes = document.querySelectorAll('input[type="checkbox"]');
                const results = [];
                
                checkboxes.forEach((checkbox, index) => {
                    const parentLabel = checkbox.closest('label');
                    const siblingSpan = checkbox.parentElement ? checkbox.parentElement.querySelector('span') : null;
                    
                    let labelText = '';
                    
                    // ラベルテキストを様々な方法で取得
                    if (parentLabel) {
                        labelText = parentLabel.textContent || parentLabel.innerText || '';
                    } else if (siblingSpan) {
                        labelText = siblingSpan.textContent || siblingSpan.innerText || '';
                    } else {
                        // 親要素や兄弟要素から探す
                        let currentElement = checkbox.parentElement;
                        let searchDepth = 0;
                        while (currentElement && searchDepth < 5) {
                            const textNodes = currentElement.querySelectorAll('span, div, label');
                            for (let node of textNodes) {
                                const text = node.textContent || node.innerText || '';
                                if (text.includes('登録内容') || text.includes('個人情報') || text.includes('同意')) {
                                    labelText = text;
                                    break;
                                }
                            }
                            if (labelText) break;
                            currentElement = currentElement.parentElement;
                            searchDepth++;
                        }
                    }
                    
                    results.push({
                        index: index,
                        checked: checkbox.checked,
                        labelText: labelText.trim(),
                        id: checkbox.id || '',
                        className: checkbox.className || '',
                        isRegistration: labelText.includes('登録内容') || labelText.includes('誤り'),
                        isPrivacy: labelText.includes('個人情報') || labelText.includes('同意')
                    });
                });
                
                return results;
            });
            
            sendLog(`🔍 チェックボックス解析結果: ${checkboxAnalysis.length}個検出`, 'info');
            checkboxAnalysis.forEach((cb, i) => {
                sendLog(`  [${i}] ${cb.labelText} (現在: ${cb.checked ? 'チェック済' : '未チェック'})`, 'info');
            });
            
            // 「登録内容に誤りはありません」チェックボックスを探してチェック
            try {
                const registrationResult = await page.evaluate(() => {
                    // input.checkbox__checkboxを探す
                    const checkboxes = document.querySelectorAll('input.checkbox__checkbox');
                    
                    for (let i = 0; i < checkboxes.length; i++) {
                        const checkbox = checkboxes[i];
                        const parentElement = checkbox.closest('.checkbox');
                        
                        if (parentElement) {
                            const labelText = parentElement.textContent || '';
                            console.log(`チェックボックス ${i}: "${labelText.trim()}"`);
                            
                            // 登録内容に関するチェックボックスを探す
                            if (labelText.includes('登録内容') && labelText.includes('誤り') && labelText.includes('ありません')) {
                                const isCurrentlyChecked = checkbox.checked;
                                console.log(`登録内容チェックボックス発見: 現在の状態=${isCurrentlyChecked}`);
                                
                                if (!isCurrentlyChecked) {
                                    // チェックボックスをクリック
                                    checkbox.click();
                                    
                                    // 少し待機してチェック状態を確認
                                    setTimeout(() => {
                                        const newState = checkbox.checked;
                                        console.log(`登録内容チェックボックス: クリック後の状態=${newState}`);
                                    }, 100);
                                    
                                    return { 
                                        found: true, 
                                        wasChecked: false, 
                                        action: 'clicked',
                                        text: labelText.trim()
                                    };
                                } else {
                                    return { 
                                        found: true, 
                                        wasChecked: true, 
                                        action: 'already_checked',
                                        text: labelText.trim()
                                    };
                                }
                            }
                        }
                    }
                    
                    return { found: false };
                });
                
                if (registrationResult.found) {
                    if (registrationResult.action === 'clicked') {
                        sendLog(`✅ 「${registrationResult.text}」をクリックしました（未チェック状態から変更）`, 'success');
                    } else {
                        sendLog(`✅ 「${registrationResult.text}」は既にチェック済みです`, 'success');
                    }
                } else {
                    sendLog(`⚠️ 登録内容チェックボックスが見つかりませんでした`, 'warning');
                }
            } catch (error) {
                sendLog(`❌ 登録内容チェックボックス処理エラー: ${error.message}`, 'error');
            }
            
            // 「個人情報の取り扱いに同意します」チェックボックスを探してチェック
            try {
                const privacyResult = await page.evaluate(() => {
                    // input.checkbox__checkboxを探す
                    const checkboxes = document.querySelectorAll('input.checkbox__checkbox');
                    
                    for (let i = 0; i < checkboxes.length; i++) {
                        const checkbox = checkboxes[i];
                        const parentElement = checkbox.closest('.checkbox');
                        
                        if (parentElement) {
                            const labelText = parentElement.textContent || '';
                            console.log(`チェックボックス ${i}: "${labelText.trim()}"`);
                            
                            // 個人情報取扱いに関するチェックボックスを探す
                            if ((labelText.includes('個人情報') && labelText.includes('同意')) || 
                                (labelText.includes('プライバシー') && labelText.includes('同意')) ||
                                (labelText.includes('取り扱い') && labelText.includes('同意'))) {
                                const isCurrentlyChecked = checkbox.checked;
                                console.log(`個人情報チェックボックス発見: 現在の状態=${isCurrentlyChecked}`);
                                
                                if (!isCurrentlyChecked) {
                                    // チェックボックスをクリック
                                    checkbox.click();
                                    
                                    // 少し待機してチェック状態を確認
                                    setTimeout(() => {
                                        const newState = checkbox.checked;
                                        console.log(`個人情報チェックボックス: クリック後の状態=${newState}`);
                                    }, 100);
                                    
                                    return { 
                                        found: true, 
                                        wasChecked: false, 
                                        action: 'clicked',
                                        text: labelText.trim()
                                    };
                                } else {
                                    return { 
                                        found: true, 
                                        wasChecked: true, 
                                        action: 'already_checked',
                                        text: labelText.trim()
                                    };
                                }
                            }
                        }
                    }
                    
                    return { found: false };
                });
                
                if (privacyResult.found) {
                    if (privacyResult.action === 'clicked') {
                        sendLog(`✅ 「${privacyResult.text}」をクリックしました（未チェック状態から変更）`, 'success');
                    } else {
                        sendLog(`✅ 「${privacyResult.text}」は既にチェック済みです`, 'success');
                    }
                } else {
                    sendLog(`⚠️ 個人情報同意チェックボックスが見つかりませんでした`, 'warning');
                }
            } catch (error) {
                sendLog(`❌ 個人情報チェックボックス処理エラー: ${error.message}`, 'error');
            }
            
            // 最終確認: すべてのHERPチェックボックスの状態を再度確認
            const finalCheckResult = await page.evaluate(() => {
                const checkboxes = document.querySelectorAll('input.checkbox__checkbox');
                const checkboxStates = [];
                
                for (let i = 0; i < checkboxes.length; i++) {
                    const checkbox = checkboxes[i];
                    const parentElement = checkbox.closest('.checkbox');
                    const labelText = parentElement ? parentElement.textContent.trim() : 'ラベル不明';
                    
                    checkboxStates.push({
                        index: i,
                        checked: checkbox.checked,
                        label: labelText
                    });
                }
                
                return checkboxStates;
            });
            
            const relevantCheckboxes = finalCheckResult.filter(cb => 
                (cb.label.includes('登録内容') && cb.label.includes('誤り')) ||
                (cb.label.includes('個人情報') && cb.label.includes('同意')) ||
                (cb.label.includes('プライバシー') && cb.label.includes('同意'))
            );
            
            if (relevantCheckboxes.length > 0) {
                const allRelevantChecked = relevantCheckboxes.every(cb => cb.checked);
                if (allRelevantChecked) {
                    sendLog(`🎉 必要なチェックボックス（${relevantCheckboxes.length}個）がすべてチェック済みです`, 'success');
                    relevantCheckboxes.forEach(cb => {
                        sendLog(`  ✅ ${cb.label}`, 'info');
                    });
                } else {
                    sendLog(`⚠️ 一部の必要なチェックボックスが未チェックです`, 'warning');
                    relevantCheckboxes.forEach(cb => {
                        const status = cb.checked ? '✅ チェック済' : '❌ 未チェック';
                        sendLog(`  ${status}: ${cb.label}`, 'info');
                    });
                }
            } else {
                sendLog(`⚠️ 関連するチェックボックスが見つかりませんでした`, 'warning');
                if (finalCheckResult.length > 0) {
                    sendLog(`発見されたチェックボックス:`, 'info');
                    finalCheckResult.forEach(cb => {
                        const status = cb.checked ? '✅' : '❌';
                        sendLog(`  ${status} ${cb.label}`, 'info');
                    });
                }
            }

            const allRelevantChecked = relevantCheckboxes.length > 0 ? relevantCheckboxes.every(cb => cb.checked) : false;
            fillResult.details.push({
                fieldName: '同意チェックボックス',
                value: allRelevantChecked ? '全てチェック完了' : '一部チェック失敗',
                source: '自動処理',
                confidence: allRelevantChecked ? 100 : 70
            });

        } catch (error) {
            sendLog(`❌ チェックボックス処理エラー: ${error.message}`, 'error');
            console.error('チェックボックスエラースタック:', error.stack);
        }

        fillResult.success = true;
        sendLog(`🎉 HERP転記完了: 合計${fillResult.filledFields}個の項目を転記しました`, 'success');

        return fillResult;

    } catch (error) {
        fillResult.error = error.message;
        sendLog(`❌ HERP転記処理エラー: ${error.message}`, 'error');
        return fillResult;
    }
}

// HERPフォームのデータ検証関数
async function verifyHerpFormData(page, enhancedData) {
    const checkResult = {
        hasErrors: false,
        errors: [],
        checkedFields: 0
    };

    try {
        // フィールドマッピング（fillHerpFormと同じ）
        const fieldMappings = {
            '応募者氏名': 'input.text-field__input[placeholder*="採用 太郎"]',
            '現所属': 'input.text-field__input[placeholder*="株式会社HERP"]',
            '年齢': 'input.text-field__input[placeholder*="27"]',
            '最終学歴': 'input.text-field__input[placeholder*="大学人事学部採用学科"]',
            '電話番号': 'input.text-field__input[placeholder*="080-1234-5678"]',
            'メールアドレス': 'input.text-field__input[placeholder*="herp@herp.co.jp"]',
            '現年収': 'input.text-field__input[placeholder*="500"]',
            '希望年収': 'input.text-field__input[placeholder*="600"]',
            '希望年収（最低）': 'input.text-field__input[placeholder*="400"]',
            '推薦時コメント': 'textarea.multiline-text-field__input[placeholder*="先月まで株式会社"]',
            '経歴': 'textarea.multiline-text-field__input[placeholder*="大学卒業後"]',
            'その他希望条件': 'textarea.multiline-text-field__input[placeholder*="ストックオプション"]',
            'リンク1': 'input.text-field__input[placeholder*="github.com/xxx"][data-index="0"]',
            'リンク2': 'input.text-field__input[placeholder*="github.com/xxx"][data-index="1"]'
        };

        // 各フィールドの値を確認
        for (const [fieldName, fieldData] of Object.entries(enhancedData.formData)) {
            if (!fieldData || typeof fieldData !== 'object') {
                continue;
            }

            const selector = fieldMappings[fieldName];
            if (!selector) {
                continue;
            }

            try {
                // フィールドが存在するか確認
                const fieldExists = await page.$(selector);
                if (!fieldExists) {
                    continue;
                }

                // HERPフォームから現在の値を取得
                const currentValue = await page.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    return element ? element.value : null;
                }, selector);

                if (currentValue === null) {
                    continue;
                }

                let expectedValue = fieldData.value;

                // 年収フィールドの場合は数値のみを抽出
                if (fieldName.includes('年収') && typeof expectedValue === 'string') {
                    const numericMatch = expectedValue.match(/(\d+)/);
                    if (numericMatch) {
                        expectedValue = numericMatch[1];
                    }
                }

                // 値を文字列に変換して比較
                const expectedStr = String(expectedValue || '').trim();
                const currentStr = String(currentValue || '').trim();

                checkResult.checkedFields++;

                // 値が異なる場合はエラーとして記録
                if (expectedStr !== currentStr) {
                    checkResult.hasErrors = true;
                    checkResult.errors.push({
                        field: fieldName,
                        message: `値が一致しません`,
                        expected: expectedStr,
                        actual: currentStr,
                        source: fieldData.source
                    });
                    sendLog(`❌ 不一致検出: ${fieldName} - 期待値: "${expectedStr}", 実際: "${currentStr}"`, 'error');
                } else {
                    sendLog(`✅ 一致確認: ${fieldName}`, 'info');
                }

            } catch (fieldError) {
                console.error(`フィールド「${fieldName}」のチェックエラー:`, fieldError);
                checkResult.errors.push({
                    field: fieldName,
                    message: `チェック中にエラーが発生しました: ${fieldError.message}`,
                    expected: fieldData.value,
                    actual: null
                });
            }
        }

        sendLog(`チェック完了: ${checkResult.checkedFields}個の項目を確認、${checkResult.errors.length}個のエラー`, 'info');

    } catch (error) {
        console.error('データ検証エラー:', error);
        checkResult.errors.push({
            field: '全般',
            message: `検証中にエラーが発生しました: ${error.message}`,
            expected: null,
            actual: null
        });
    }

    return checkResult;
}