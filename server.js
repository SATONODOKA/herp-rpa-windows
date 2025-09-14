const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

let browser = null;
let page = null;
let sseClients = [];

// 安全性設定
const SAFETY_CONFIG = {
    MINIMUM_CONFIDENCE_THRESHOLD: 90,
    ENABLE_STRICT_MODE: true,
    LOG_ALL_EXTRACTIONS: true
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
        additionalRequiredFields: [] // 追加必須項目
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
                
                if (atsInputType && atsInputType.includes('追加指定項目あり') && additionalFields) {
                    extractionResult.additionalRequiredFields = Array.isArray(additionalFields) ? additionalFields : [];
                    if (extractionResult.additionalRequiredFields.length > 0) {
                        extractionResult.warnings.push(`追加必須項目が指定されています: ${extractionResult.additionalRequiredFields.join(', ')}`);
                    }
                }
            }
            
            // パターン: "W送付" + 求人名 + "※"
            const pattern = /W送付\s*(.+?)\s*※/;
            const match = raMemoRaw.match(pattern);
            
            if (match && match[1]) {
                let jobName = match[1].trim();
                
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
                extractionResult.method = 'ra_memo_pattern_extraction';
                
                // 追加の検証
                if (jobName.includes('【') && jobName.includes('】')) {
                    extractionResult.confidence = 98;
                    extractionResult.warnings.push("役職情報を含む求人名を検出");
                }
                
                return extractionResult;
            } else {
                extractionResult.errors.push("ra_memo_rawから求人名パターンを抽出できませんでした");
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
async function analyzeRecommendationForm(page, jobName, additionalRequiredFields = []) {
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
            appliedCount: 0,
            appliedFields: []
        }
    };

    try {
        // 現在のページURLを取得
        analysisResult.pageUrl = await page.url();
        sendLog(`フォーム解析開始: ${analysisResult.pageUrl}`);

        // ページ内のフォーム項目を解析
        const formData = await page.evaluate(() => {
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

                    // Unknown Fieldと不要項目（1,2,20,22番目）を除外し、名前が取得できたフィールドのみを追加
                    if (fieldName !== 'Unknown Field' && fieldName.trim() !== '' && 
                        fieldName !== '推薦元' && fieldName !== '職種' &&
                        fieldName !== '登録内容の確認' && fieldName !== '個人情報の取り扱いに同意します') {
                        fields.push({
                            index: index + 1,
                            name: fieldName,
                            type: fieldType,
                            required: isRequired,
                            detectionMethod: detectionMethod,
                            hasLabel: !!labelElement,
                            hasRequiredIndicator: !!requiredElement,
                            hasOptionalIndicator: !!optionalElement,
                            hasInput: !!inputElement
                        });
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

            return {
                fields: fields,
                companyName: companyName,
                totalElements: formElements.length,
                labeledItems: labeledFormItems.length
            };
        });

        analysisResult.fields = formData.fields;
        analysisResult.companyName = formData.companyName;
        
        // 追加必須項目の適用（既存機能の後に実行）
        if (additionalRequiredFields && additionalRequiredFields.length > 0) {
            additionalRequiredFields.forEach(requiredField => {
                const matches = analysisResult.fields.filter(field => {
                    const fieldName = field.name.toLowerCase();
                    const requiredName = requiredField.toLowerCase();
                    
                    // 完全一致または部分一致
                    return fieldName === requiredName || 
                           fieldName.includes(requiredName) || 
                           requiredName.includes(fieldName);
                });
                
                matches.forEach(field => {
                    if (!field.required) {
                        field.required = true;
                        field.detectionMethod += ' + additional-required';
                        analysisResult.additionalRequiredOverrides.appliedCount++;
                        analysisResult.additionalRequiredOverrides.appliedFields.push({
                            fieldName: field.name,
                            originalRequired: false,
                            overriddenBy: requiredField
                        });
                    }
                });
            });
        }
        
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
        const filePath = path.join(__dirname, 'form_analysis', fileName);

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

app.post('/execute', async (req, res) => {
    try {
        const { data } = req.body;
        
        if (!data) {
            sendLog('JSONデータが含まれていません', 'error');
            return res.status(400).json({ error: 'JSONデータが含まれていません' });
        }

        // 新しい抽出機能を使用
        sendLog('求人名の抽出を開始しています...');
        const extractionResult = extractJobNameFromComplexFormat(data);
        
        if (!extractionResult.success) {
            sendLog(`求人名の抽出に失敗しました: ${extractionResult.errors.join(', ')}`, 'error');
            return res.status(400).json({ 
                error: '求人名の抽出に失敗しました',
                details: extractionResult.errors 
            });
        }

        const inputJobName = extractionResult.extractedName;
        sendLog(`抽出された求人名: ${inputJobName} (信頼度: ${extractionResult.confidence}%, 方法: ${extractionResult.method})`);
        
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
        
        if (browser) {
            await browser.close();
        }
        
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });
        
        sendLog('新しいページを作成しています...');
        page = await browser.newPage();
        
        sendLog('指定のURLにアクセスしています...');
        await page.goto('https://agent.herp.cloud/p/HO3nC9noAkwOgXlKbC-hDeewP8nK4yQlrT2OnkN2XTw', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
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
            
            validButtons.forEach((button, index) => {
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
            
            const result = {
                inputJobName,
                extractionDetails: extractionResult,
                matchedJob: null,
                matchType: 'none',
                confidence: 0,
                availableJobs: jobListings,
                errors: matchResult.errors,
                alternatives: matchResult.alternatives
            };
            
            sendEvent({ type: 'result', result });
            sendLog('処理が完了しました（マッチング失敗）', 'warning');
            sendEvent({ type: 'complete' });
            
            return res.json({ 
                message: 'マッチングに失敗しました',
                result 
            });
        }

        // 成功した場合 - ボタンクリック処理を追加
        sendLog(`${matchResult.matchType === 'exact' ? '完全' : '部分'}一致: ${inputJobName} → ${matchResult.matchedJob} (信頼度: ${matchResult.confidence}%)`, 'success');
        
        // マッチした求人に対応するボタンをクリック
        sendLog('対応する「この職種に推薦する」ボタンを検索しています...');
        
        const clickResult = await clickRecommendationButton(page, matchResult.matchedJob);
        
        let formAnalysisResult = null;
        
        // ボタンクリックが成功した場合、フォーム解析を実行
        if (clickResult.success) {
            sendLog('推薦ページのフォーム項目を解析しています...', 'info');
            
            // ページ遷移を待機
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            formAnalysisResult = await analyzeRecommendationForm(page, matchResult.matchedJob, extractionResult.additionalRequiredFields);
            
            if (formAnalysisResult.success) {
                sendLog(`フォーム解析完了: ${formAnalysisResult.totalFields}個の項目を検出`, 'success');
                
                // 結果をファイルに保存
                const savedFile = await saveFormAnalysisToFile(formAnalysisResult, matchResult.matchedJob);
                formAnalysisResult.savedFile = savedFile;
            } else {
                sendLog(`フォーム解析に失敗: ${formAnalysisResult.error}`, 'error');
            }
        }
        
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
            formAnalysis: formAnalysisResult
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
        res.status(500).json({ error: 'ブラウザの起動に失敗しました: ' + error.message });
    }
});

app.post('/close', async (req, res) => {
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