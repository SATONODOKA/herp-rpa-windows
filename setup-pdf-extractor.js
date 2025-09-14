#!/usr/bin/env node

/**
 * PDF抽出機能セットアップスクリプト
 * 
 * 使用方法:
 * node setup-pdf-extractor.js /path/to/target/project
 * 
 * または、Cursorで以下をコピー&ペーストして実行:
 * 1. このファイル全体をコピー
 * 2. 対象プロジェクトに setup-pdf-extractor.js として保存
 * 3. ターミナルで実行: node setup-pdf-extractor.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 必要なファイルの内容を埋め込み
const FILES = {
    'pdf-extractor.js': `const fs = require('fs');
const pdfParse = require('pdf-parse');
const PDFParser = require('pdf2json');

// PDFのページレンダリング関数（日本語対応）
function render_page(pageData) {
    // ページごとのテキストを取得
    let render_options = {
        normalizeWhitespace: false,
        disableCombineTextItems: false
    };
    
    return pageData.getTextContent(render_options).then(function(textContent) {
        let lastY, text = '';
        
        // テキストアイテムを処理
        for (let item of textContent.items) {
            if (lastY == item.transform[5] || !lastY) {
                text += item.str;
            } else {
                text += '\\n' + item.str;
            }
            lastY = item.transform[5];
        }
        
        // 日本語文字化け対策
        try {
            // UTF-8として再エンコード
            text = Buffer.from(text, 'binary').toString('utf8');
        } catch (e) {
            // エンコードに失敗した場合はそのまま使用
        }
        
        return text;
    });
}

// pdf2jsonを使ってテキスト抽出
function extractTextWithPDF2JSON(pdfPath) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        
        pdfParser.on("pdfParser_dataError", errData => {
            reject(errData.parserError);
        });
        
        pdfParser.on("pdfParser_dataReady", pdfData => {
            try {
                let text = '';
                
                // 各ページの処理
                pdfData.Pages.forEach((page, pageIndex) => {
                    text += \`\\n--- ページ \${pageIndex + 1} ---\\n\`;
                    
                    // テキストを位置でソート
                    const textItems = [];
                    page.Texts.forEach(textObj => {
                        textObj.R.forEach(run => {
                            textItems.push({
                                x: textObj.x,
                                y: textObj.y,
                                text: decodeURIComponent(run.T)
                            });
                        });
                    });
                    
                    // Y座標でソート（上から下へ）
                    textItems.sort((a, b) => b.y - a.y);
                    
                    let currentY = null;
                    let line = '';
                    
                    textItems.forEach(item => {
                        if (currentY === null || Math.abs(currentY - item.y) < 0.5) {
                            line += item.text + ' ';
                            currentY = item.y;
                        } else {
                            if (line.trim()) {
                                text += line.trim() + '\\n';
                            }
                            line = item.text + ' ';
                            currentY = item.y;
                        }
                    });
                    
                    if (line.trim()) {
                        text += line.trim() + '\\n';
                    }
                });
                
                resolve(text);
            } catch (error) {
                reject(error);
            }
        });
        
        pdfParser.loadPDF(pdfPath);
    });
}

// 統一されたPDF抽出関数
async function extractPDFText(pdfPath, options = {}) {
    const log = options.log || ((message, type) => console.log(\`[\${type}] \${message}\`));
    
    try {
        log('PDFファイルを読み込んでいます...', 'info');
        const dataBuffer = fs.readFileSync(pdfPath);
        
        // 方法1: pdf-parseのオプションを日本語対応に設定
        log('方法1: pdf-parseでテキスト抽出中...', 'info');
        const pdfParseOptions = {
            pagerender: render_page,
            normalizeWhitespace: false,
            disableCombineTextItems: false
        };
        
        const pdfData = await pdfParse(dataBuffer, pdfParseOptions);
        log(\`PDF情報を取得しました (\${pdfData.numpages}ページ)\`, 'success');
        
        // 方法2: pdf2jsonでテキスト抽出を試行
        log('方法2: pdf2jsonでテキスト抽出中...', 'info');
        let pdf2jsonText = '';
        try {
            pdf2jsonText = await extractTextWithPDF2JSON(pdfPath);
            log(\`pdf2jsonでテキスト抽出完了 (\${pdf2jsonText.length}文字)\`, 'success');
        } catch (error) {
            log(\`pdf2jsonでエラー: \${error.message}\`, 'error');
        }
        
        // より多くのテキストを抽出できた方を使用
        const pdfParseText = pdfData.text;
        const extractedText = pdf2jsonText.length > pdfParseText.length ? pdf2jsonText : pdfParseText;
        const method = pdf2jsonText.length > pdfParseText.length ? 'pdf2json' : 'pdf-parse';
        
        log(\`\${method}を使用してテキスト抽出完了 (\${extractedText.length}文字)\`, 'success');
        log(\`pdf-parse: \${pdfParseText.length}文字 vs pdf2json: \${pdf2jsonText.length}文字\`, 'info');
        
        return {
            extractedText,
            method,
            pdfPages: pdfData.numpages,
            rawPdfParseText: pdfParseText,
            rawPdf2jsonText: pdf2jsonText
        };
        
    } catch (error) {
        log(\`PDF抽出中にエラーが発生しました: \${error.message}\`, 'error');
        throw error;
    }
}

// PDFテキストを詳細解析してフォーム入力用のデータを抽出
function analyzePDFText(pdfText) {
    const lines = pdfText.split('\\n').map(line => line.trim()).filter(line => line);
    
    const result = {
        fullText: pdfText,
        lines: lines,
        keywords: [],
        personalInfo: [],
        phoneNumbers: [],
        emails: [],
        addresses: [],
        dates: [],
        // フォーム入力用の構造化データ
        formData: {
            name: '',
            furigana: '',
            email: '',
            phone: '',
            address: '',
            birthDate: '',
            gender: '',
            education: [],
            workExperience: [],
            qualifications: []
        }
    };
    
    // 履歴書でよく出現するキーワード
    const resumeKeywords = ['履歴書', '氏名', '名前', '生年月日', '住所', '電話', 'メール', '学歴', '職歴', '資格', '志望動機'];
    
    lines.forEach((line, index) => {
        // キーワード検出
        resumeKeywords.forEach(keyword => {
            if (line.includes(keyword) && !result.keywords.includes(keyword)) {
                result.keywords.push(keyword);
            }
        });
        
        // 氏名の抽出（より精密に、多様なパターンに対応）
        if (!result.formData.name) {
            const namePatterns = [
                // "氏名　田中　太郎" のようなパターン
                /氏名[\\s　]*([一-龯]{1,5}[\\s　]+[一-龯]{1,5})/,
                // "田中　太郎　氏名" のようなパターン
                /([一-龯]{1,5}[\\s　]+[一-龯]{1,5})[\\s　]*氏名/,
                // "名前：田中太郎" のようなパターン
                /名前[\\s：　]*([一-龯]{1,5}[\\s　]*[一-龯]{1,5})/,
                // "氏名" の次の行にある名前
                index > 0 && lines[index - 1].includes('氏名') ? /^([一-龯]{1,5}[\\s　]+[一-龯]{1,5})$/ : null,
                // ふりがなの後にある漢字名（2行後をチェック）
                index > 1 && lines[index - 2].includes('ふりがな') ? /^([一-龯]{1,5}[\\s　]+[一-龯]{1,5})$/ : null
            ].filter(Boolean);
            
            for (const pattern of namePatterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    const name = match[1].replace(/[\\s　]+/g, ' ').trim();
                    // 名前として妥当かチェック（2-10文字の漢字）
                    if (name.length >= 2 && name.length <= 10) {
                        result.formData.name = name;
                        result.personalInfo.push(\`氏名: \${result.formData.name}\`);
                        break;
                    }
                }
            }
        }
        
        // ふりがなの抽出（より柔軟に）
        if (!result.formData.furigana) {
            const furiganaPatterns = [
                // "ふりがな たなか　たろう"
                /ふりがな[\\s　]*([あ-ん\\s　]+)/,
                // "フリガナ タナカ　タロウ"
                /フリガナ[\\s　]*([ア-ン\\s　]+)/,
                // "かな" の後
                /かな[\\s　]*([あ-ん\\s　]+)/,
                // "カナ" の後
                /カナ[\\s　]*([ア-ン\\s　]+)/,
                // ふりがなの次の行
                index > 0 && lines[index - 1].includes('ふりがな') ? /^([あ-ん\\s　]+)$/ : null
            ].filter(Boolean);
            
            for (const pattern of furiganaPatterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    let furigana = match[1].replace(/[\\s　]+/g, ' ').trim();
                    // カタカナをひらがなに変換
                    furigana = furigana.replace(/[ア-ン]/g, (match) => 
                        String.fromCharCode(match.charCodeAt(0) - 0x60));
                    
                    if (furigana.length >= 2 && furigana.length <= 20) {
                        result.formData.furigana = furigana;
                        break;
                    }
                }
            }
        }
        
        // 電話番号（より多様なパターン）
        if (!result.formData.phone) {
            const phonePatterns = [
                /(\\d{2,4}[-－]\\d{2,4}[-－]\\d{4})/,  // ハイフンあり
                /(\\d{10,11})/,  // ハイフンなし
                /電話[\\s：　]*(\\d{2,4}[-－]\\d{2,4}[-－]\\d{4})/,  // "電話：" の後
                /TEL[\\s：　]*(\\d{2,4}[-－]\\d{2,4}[-－]\\d{4})/   // "TEL：" の後
            ];
            
            for (const pattern of phonePatterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    result.formData.phone = match[1];
                    result.phoneNumbers.push(match[1]);
                    break;
                }
            }
        }
        
        // メールアドレス（複数行にまたがる場合も対応、強化版）
        if (!result.formData.email) {
            // 現在行でのマッチを試行
            const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/;
            const match = line.match(emailPattern);
            if (match && match[1]) {
                result.formData.email = match[1];
                result.emails.push(match[1]);
            } else {
                // 改行で分割されたメールアドレスを検出
                // パターン1: "user@domain.co" の形で終わっている場合
                const partialEmailPattern1 = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{1,2})$/;
                const partialMatch1 = line.match(partialEmailPattern1);
                
                if (partialMatch1) {
                    // 次の数行をチェック（最大3行先まで）
                    for (let j = 1; j <= 3 && index + j < lines.length; j++) {
                        const nextLine = lines[index + j].trim();
                        // 1-3文字の文字（"m", "com", "jp"など）の場合、結合
                        if (/^[a-zA-Z]{1,3}$/.test(nextLine)) {
                            const completeEmail = partialMatch1[1] + nextLine;
                            if (emailPattern.test(completeEmail)) {
                                result.formData.email = completeEmail;
                                result.emails.push(completeEmail);
                                break;
                            }
                        }
                    }
                } else {
                    // パターン2: "user@domain" の形で終わっている場合
                    const partialEmailPattern2 = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)$/;
                    const partialMatch2 = line.match(partialEmailPattern2);
                    
                    if (partialMatch2) {
                        // 次の数行から ".com", ".co.jp" などを探す
                        for (let j = 1; j <= 3 && index + j < lines.length; j++) {
                            const nextLine = lines[index + j].trim();
                            if (/^\\.?[a-zA-Z]{2,4}$/.test(nextLine)) {
                                const domain = nextLine.startsWith('.') ? nextLine : '.' + nextLine;
                                const completeEmail = partialMatch2[1] + domain;
                                if (emailPattern.test(completeEmail)) {
                                    result.formData.email = completeEmail;
                                    result.emails.push(completeEmail);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // 住所（都道府県を含む行、より柔軟に）
        if (!result.formData.address) {
            const addressPattern = /((?:東京都|神奈川県|大阪府|京都府|北海道|[一-龯]{2,3}県)[一-龯市区町村\\d\\-\\s　]+)/;
            const match = line.match(addressPattern);
            if (match && match[1]) {
                const address = match[1].trim();
                if (address.length >= 5) {  // 最小長チェック
                    result.formData.address = address;
                    result.addresses.push(address);
                }
            }
        }
        
        // 生年月日（より多様なパターン）
        if (!result.formData.birthDate) {
            const birthPatterns = [
                // "1990年4月15日生"
                /(\\d{4})\\s*年[\\s　]*(\\d{1,2})\\s*月[\\s　]*(\\d{1,2})\\s*日[\\s　]*生/,
                // "生年月日　1990年4月15日"
                /生年月日[\\s　]*(\\d{4})\\s*年[\\s　]*(\\d{1,2})\\s*月[\\s　]*(\\d{1,2})\\s*日/,
                // "1990/04/15"
                /(\\d{4})\\/(\\d{1,2})\\/(\\d{1,2})/,
                // "1990-04-15"
                /(\\d{4})-(\\d{1,2})-(\\d{1,2})/
            ];
            
            for (const pattern of birthPatterns) {
                const match = line.match(pattern);
                if (match && match[1] && match[2] && match[3]) {
                    const year = parseInt(match[1]);
                    const month = parseInt(match[2]);
                    const day = parseInt(match[3]);
                    
                    // 妥当性チェック
                    if (year >= 1900 && year <= new Date().getFullYear() && 
                        month >= 1 && month <= 12 && 
                        day >= 1 && day <= 31) {
                        
                        const formattedMonth = month.toString().padStart(2, '0');
                        const formattedDay = day.toString().padStart(2, '0');
                        result.formData.birthDate = \`\${year}/\${formattedMonth}/\${formattedDay}\`;
                        result.dates.push(result.formData.birthDate);
                        break;
                    }
                }
            }
        }
        
        // 性別（より精密に）
        if (!result.formData.gender) {
            if ((line.includes('男') && !line.includes('女')) || line.includes('男性')) {
                // "男" を含むが "女" は含まない、または "男性" を含む
                if (line.length < 20) {  // 短い行でのみ判定
                    result.formData.gender = '男';
                }
            } else if ((line.includes('女') && !line.includes('男')) || line.includes('女性')) {
                // "女" を含むが "男" は含まない、または "女性" を含む
                if (line.length < 20) {  // 短い行でのみ判定
                    result.formData.gender = '女';
                }
            }
        }
    });
    
    // 学歴・職歴・資格の簡単な抽出
    let inEducationSection = false;
    let inWorkSection = false;
    let inQualificationSection = false;
    
    lines.forEach((line) => {
        if (line.includes('学歴')) {
            inEducationSection = true;
            inWorkSection = false;
            inQualificationSection = false;
        } else if (line.includes('職歴')) {
            inEducationSection = false;
            inWorkSection = true;
            inQualificationSection = false;
        } else if (line.includes('資格') || line.includes('免許')) {
            inEducationSection = false;
            inWorkSection = false;
            inQualificationSection = true;
        } else if (line.includes('志望動機') || line.includes('自己PR')) {
            inEducationSection = false;
            inWorkSection = false;
            inQualificationSection = false;
        }
        
        // 各セクションの内容を収集
        if (inEducationSection && line.length > 3 && !line.includes('学歴')) {
            result.formData.education.push(line);
        } else if (inWorkSection && line.length > 3 && !line.includes('職歴')) {
            result.formData.workExperience.push(line);
        } else if (inQualificationSection && line.length > 3 && !line.includes('資格') && !line.includes('免許')) {
            result.formData.qualifications.push(line);
        }
    });
    
    return result;
}

// 簡単な使用例関数
async function extractResumeData(pdfPath, options = {}) {
    try {
        // PDF抽出
        const pdfResult = await extractPDFText(pdfPath, options);
        
        // データ解析
        const analyzedData = analyzePDFText(pdfResult.extractedText);
        
        return {
            timestamp: new Date().toISOString(),
            pdfPath: pdfPath,
            extractionMethod: pdfResult.method,
            textLength: pdfResult.extractedText.length,
            pdfPages: pdfResult.pdfPages,
            rawText: pdfResult.extractedText,
            analyzedData: analyzedData
        };
    } catch (error) {
        throw new Error(\`履歴書データ抽出エラー: \${error.message}\`);
    }
}

module.exports = {
    extractPDFText,
    analyzePDFText,
    extractResumeData,
    extractTextWithPDF2JSON,
    render_page
};`,

    'test-pdf-extractor.js': `// PDF抽出機能のテストファイル
const { extractResumeData } = require('./pdf-extractor');
const fs = require('fs');

async function testPDFExtractor() {
    console.log('🧪 PDF抽出機能のテストを開始します...');
    
    // テスト用PDFファイルのパスを指定
    const testPdfPath = './sample-resume.pdf'; // ここにテスト用PDFのパスを設定
    
    if (!fs.existsSync(testPdfPath)) {
        console.log('❌ テスト用PDFファイルが見つかりません');
        console.log(\`📁 \${testPdfPath} にPDFファイルを配置してください\`);
        return;
    }
    
    try {
        const result = await extractResumeData(testPdfPath, {
            log: (message, type) => {
                const prefix = type === 'success' ? '✅' : 
                             type === 'error' ? '❌' : 
                             type === 'warning' ? '⚠️' : 'ℹ️';
                console.log(\`\${prefix} \${message}\`);
            }
        });
        
        console.log('\\n📊 抽出結果:');
        console.log(\`抽出方法: \${result.extractionMethod}\`);
        console.log(\`ページ数: \${result.pdfPages}\`);
        console.log(\`文字数: \${result.textLength}\`);
        
        console.log('\\n👤 個人情報:');
        console.log(\`氏名: \${result.analyzedData.formData.name}\`);
        console.log(\`ふりがな: \${result.analyzedData.formData.furigana}\`);
        console.log(\`メール: \${result.analyzedData.formData.email}\`);
        console.log(\`電話: \${result.analyzedData.formData.phone}\`);
        console.log(\`住所: \${result.analyzedData.formData.address}\`);
        console.log(\`生年月日: \${result.analyzedData.formData.birthDate}\`);
        console.log(\`性別: \${result.analyzedData.formData.gender}\`);
        
        console.log('\\n✅ テスト完了！');
        
    } catch (error) {
        console.error('❌ テストエラー:', error.message);
    }
}

if (require.main === module) {
    testPDFExtractor();
}

module.exports = { testPDFExtractor };`,

    'README-PDF-EXTRACTOR.md': `# PDF履歴書抽出ライブラリ

日本語履歴書PDFから個人情報を自動抽出するNode.jsライブラリです。

## 🚀 セットアップ

### 1. 依存関係のインストール
\`\`\`bash
npm install pdf-parse pdf2json
\`\`\`

### 2. ファイルの配置
以下のファイルをプロジェクトにコピーしてください：
- \`pdf-extractor.js\` - メインライブラリ
- \`test-pdf-extractor.js\` - テスト用ファイル

## 📋 基本的な使用方法

\`\`\`javascript
const { extractResumeData } = require('./pdf-extractor');

// 履歴書PDFから全データを抽出
async function example() {
    try {
        const result = await extractResumeData('resume.pdf');
        
        console.log('氏名:', result.analyzedData.formData.name);
        console.log('メール:', result.analyzedData.formData.email);
        console.log('電話:', result.analyzedData.formData.phone);
        
    } catch (error) {
        console.error('エラー:', error.message);
    }
}
\`\`\`

## 🧪 テスト方法

1. \`sample-resume.pdf\` という名前でテスト用PDFを配置
2. テストを実行:
   \`\`\`bash
   node test-pdf-extractor.js
   \`\`\`

## 📊 抽出可能なデータ

- **基本情報**: 氏名、ふりがな、メール、電話、住所、生年月日、性別
- **学歴**: 学校名、卒業年月
- **職歴**: 会社名、在籍期間
- **資格**: 取得資格、取得年月

## 🔧 カスタマイズ

### ログ機能のカスタマイズ
\`\`\`javascript
const result = await extractResumeData('resume.pdf', {
    log: (message, type) => {
        console.log(\`[\${type}] \${message}\`);
    }
});
\`\`\`

### テキスト抽出のみ
\`\`\`javascript
const { extractPDFText } = require('./pdf-extractor');

const result = await extractPDFText('resume.pdf');
console.log(result.extractedText);
\`\`\`

## ⚠️ 制限事項

- **対応形式**: テキスト情報を含むPDF
- **非対応**: 画像のみのPDF（OCR機能なし）
- **言語**: 日本語履歴書に最適化

## 🛠️ トラブルシューティング

### 文字数が少ない場合
- PDF形式を変更（Word→PDF再変換など）
- 別のPDF作成ソフトを使用

### 項目が抽出されない場合
- 履歴書のフォーマットを標準的なものに変更
- 手動でJSONファイルを編集

## 📞 サポート

問題が発生した場合は、以下を確認してください：
1. PDFファイルがテキスト情報を含んでいるか
2. 依存関係が正しくインストールされているか
3. ファイルパスが正しいか`
};

class PDFExtractorSetup {
    constructor(targetDir = process.cwd()) {
        this.targetDir = path.resolve(targetDir);
        this.logPrefix = '🔧 PDF抽出セットアップ';
    }

    log(message, type = 'info') {
        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        };
        console.log(`${icons[type]} ${this.logPrefix}: ${message}`);
    }

    async setup() {
        try {
            this.log('セットアップを開始します...', 'info');
            
            // 1. ディレクトリの確認
            this.log(`対象ディレクトリ: ${this.targetDir}`, 'info');
            
            if (!fs.existsSync(this.targetDir)) {
                fs.mkdirSync(this.targetDir, { recursive: true });
                this.log('ディレクトリを作成しました', 'success');
            }

            // 2. ファイルの作成
            this.log('必要なファイルを作成中...', 'info');
            
            for (const [filename, content] of Object.entries(FILES)) {
                const filePath = path.join(this.targetDir, filename);
                fs.writeFileSync(filePath, content, 'utf8');
                this.log(`作成: ${filename}`, 'success');
            }

            // 3. package.jsonの確認・更新
            await this.updatePackageJson();

            // 4. 依存関係のインストール
            await this.installDependencies();

            // 5. セットアップ完了メッセージ
            this.showCompletionMessage();

        } catch (error) {
            this.log(`セットアップエラー: ${error.message}`, 'error');
            throw error;
        }
    }

    async updatePackageJson() {
        const packageJsonPath = path.join(this.targetDir, 'package.json');
        
        let packageJson = {};
        
        if (fs.existsSync(packageJsonPath)) {
            try {
                const content = fs.readFileSync(packageJsonPath, 'utf8');
                packageJson = JSON.parse(content);
                this.log('既存のpackage.jsonを確認しました', 'info');
            } catch (error) {
                this.log('package.jsonの読み込みに失敗、新規作成します', 'warning');
            }
        } else {
            this.log('package.jsonを新規作成します', 'info');
            packageJson = {
                name: path.basename(this.targetDir),
                version: '1.0.0',
                description: 'PDF履歴書抽出機能付きプロジェクト',
                main: 'index.js',
                scripts: {
                    test: 'node test-pdf-extractor.js'
                }
            };
        }

        // 依存関係を追加
        if (!packageJson.dependencies) {
            packageJson.dependencies = {};
        }

        const requiredDeps = {
            'pdf-parse': '^1.1.1',
            'pdf2json': '^3.0.5'
        };

        let needsUpdate = false;
        for (const [dep, version] of Object.entries(requiredDeps)) {
            if (!packageJson.dependencies[dep]) {
                packageJson.dependencies[dep] = version;
                needsUpdate = true;
                this.log(`依存関係を追加: ${dep}@${version}`, 'info');
            }
        }

        if (needsUpdate || !fs.existsSync(packageJsonPath)) {
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
            this.log('package.jsonを更新しました', 'success');
        }
    }

    async installDependencies() {
        this.log('依存関係をインストール中...', 'info');
        
        try {
            // npm installを実行
            process.chdir(this.targetDir);
            execSync('npm install', { stdio: 'pipe' });
            this.log('依存関係のインストールが完了しました', 'success');
        } catch (error) {
            this.log('npm installに失敗しました。手動でインストールしてください:', 'warning');
            this.log('npm install pdf-parse pdf2json', 'info');
        }
    }

    showCompletionMessage() {
        console.log('\\n' + '='.repeat(60));
        console.log('🎉 PDF抽出機能のセットアップが完了しました！');
        console.log('='.repeat(60));
        
        console.log('\\n📁 作成されたファイル:');
        console.log('  ├── pdf-extractor.js      (メインライブラリ)');
        console.log('  ├── test-pdf-extractor.js (テスト用ファイル)');
        console.log('  ├── README-PDF-EXTRACTOR.md (使用方法)');
        console.log('  └── package.json          (依存関係)');
        
        console.log('\\n🚀 使用方法:');
        console.log('1. テスト用PDFを配置:');
        console.log('   cp /path/to/resume.pdf ./sample-resume.pdf');
        console.log('\\n2. テスト実行:');
        console.log('   node test-pdf-extractor.js');
        console.log('\\n3. コードで使用:');
        console.log('   const { extractResumeData } = require(\\'./pdf-extractor\\');');
        
        console.log('\\n📖 詳細な使用方法:');
        console.log('   README-PDF-EXTRACTOR.md をご確認ください');
        
        console.log('\\n' + '='.repeat(60));
    }
}

// メイン実行
async function main() {
    const args = process.argv.slice(2);
    const targetDir = args[0] || process.cwd();
    
    console.log('🔧 PDF履歴書抽出機能セットアップツール');
    console.log('==========================================\\n');
    
    const setup = new PDFExtractorSetup(targetDir);
    await setup.setup();
}

// コマンドライン実行時
if (require.main === module) {
    main().catch(error => {
        console.error('❌ セットアップに失敗しました:', error.message);
        process.exit(1);
    });
}

module.exports = { PDFExtractorSetup, FILES };`
};

class PDFExtractorSetup {
    constructor(targetDir = process.cwd()) {
        this.targetDir = path.resolve(targetDir);
        this.logPrefix = '🔧 PDF抽出セットアップ';
    }

    log(message, type = 'info') {
        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        };
        console.log(`${icons[type]} ${this.logPrefix}: ${message}`);
    }

    async setup() {
        try {
            this.log('セットアップを開始します...', 'info');
            
            // 1. ディレクトリの確認
            this.log(`対象ディレクトリ: ${this.targetDir}`, 'info');
            
            if (!fs.existsSync(this.targetDir)) {
                fs.mkdirSync(this.targetDir, { recursive: true });
                this.log('ディレクトリを作成しました', 'success');
            }

            // 2. ファイルの作成
            this.log('必要なファイルを作成中...', 'info');
            
            for (const [filename, content] of Object.entries(FILES)) {
                const filePath = path.join(this.targetDir, filename);
                fs.writeFileSync(filePath, content, 'utf8');
                this.log(`作成: ${filename}`, 'success');
            }

            // 3. package.jsonの確認・更新
            await this.updatePackageJson();

            // 4. 依存関係のインストール
            await this.installDependencies();

            // 5. セットアップ完了メッセージ
            this.showCompletionMessage();

        } catch (error) {
            this.log(`セットアップエラー: ${error.message}`, 'error');
            throw error;
        }
    }

    async updatePackageJson() {
        const packageJsonPath = path.join(this.targetDir, 'package.json');
        
        let packageJson = {};
        
        if (fs.existsSync(packageJsonPath)) {
            try {
                const content = fs.readFileSync(packageJsonPath, 'utf8');
                packageJson = JSON.parse(content);
                this.log('既存のpackage.jsonを確認しました', 'info');
            } catch (error) {
                this.log('package.jsonの読み込みに失敗、新規作成します', 'warning');
            }
        } else {
            this.log('package.jsonを新規作成します', 'info');
            packageJson = {
                name: path.basename(this.targetDir),
                version: '1.0.0',
                description: 'PDF履歴書抽出機能付きプロジェクト',
                main: 'index.js',
                scripts: {
                    test: 'node test-pdf-extractor.js'
                }
            };
        }

        // 依存関係を追加
        if (!packageJson.dependencies) {
            packageJson.dependencies = {};
        }

        const requiredDeps = {
            'pdf-parse': '^1.1.1',
            'pdf2json': '^3.0.5'
        };

        let needsUpdate = false;
        for (const [dep, version] of Object.entries(requiredDeps)) {
            if (!packageJson.dependencies[dep]) {
                packageJson.dependencies[dep] = version;
                needsUpdate = true;
                this.log(`依存関係を追加: ${dep}@${version}`, 'info');
            }
        }

        if (needsUpdate || !fs.existsSync(packageJsonPath)) {
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
            this.log('package.jsonを更新しました', 'success');
        }
    }

    async installDependencies() {
        this.log('依存関係をインストール中...', 'info');
        
        try {
            // npm installを実行
            process.chdir(this.targetDir);
            execSync('npm install', { stdio: 'pipe' });
            this.log('依存関係のインストールが完了しました', 'success');
        } catch (error) {
            this.log('npm installに失敗しました。手動でインストールしてください:', 'warning');
            this.log('npm install pdf-parse pdf2json', 'info');
        }
    }

    showCompletionMessage() {
        console.log('\\n' + '='.repeat(60));
        console.log('🎉 PDF抽出機能のセットアップが完了しました！');
        console.log('='.repeat(60));
        
        console.log('\\n📁 作成されたファイル:');
        console.log('  ├── pdf-extractor.js      (メインライブラリ)');
        console.log('  ├── test-pdf-extractor.js (テスト用ファイル)');
        console.log('  ├── README-PDF-EXTRACTOR.md (使用方法)');
        console.log('  └── package.json          (依存関係)');
        
        console.log('\\n🚀 使用方法:');
        console.log('1. テスト用PDFを配置:');
        console.log('   cp /path/to/resume.pdf ./sample-resume.pdf');
        console.log('\\n2. テスト実行:');
        console.log('   node test-pdf-extractor.js');
        console.log('\\n3. コードで使用:');
        console.log('   const { extractResumeData } = require(\\'./pdf-extractor\\');');
        
        console.log('\\n📖 詳細な使用方法:');
        console.log('   README-PDF-EXTRACTOR.md をご確認ください');
        
        console.log('\\n' + '='.repeat(60));
    }
}

// メイン実行
async function main() {
    const args = process.argv.slice(2);
    const targetDir = args[0] || process.cwd();
    
    console.log('🔧 PDF履歴書抽出機能セットアップツール');
    console.log('==========================================\\n');
    
    const setup = new PDFExtractorSetup(targetDir);
    await setup.setup();
}

// コマンドライン実行時
if (require.main === module) {
    main().catch(error => {
        console.error('❌ セットアップに失敗しました:', error.message);
        process.exit(1);
    });
}

module.exports = { PDFExtractorSetup, FILES }; 