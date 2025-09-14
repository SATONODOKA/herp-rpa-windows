const fs = require('fs');
const pdfParse = require('pdf-parse');
const PDFParser = require('pdf2json');

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
                    text += `\n--- ページ ${pageIndex + 1} ---\n`;
                    
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
                                text += line.trim() + '\n';
                            }
                            line = item.text + ' ';
                            currentY = item.y;
                        }
                    });
                    
                    if (line.trim()) {
                        text += line.trim() + '\n';
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
    const log = options.log || ((message, type) => console.log(`[${type}] ${message}`));
    
    try {
        log('PDFファイルを読み込んでいます...', 'info');
        const dataBuffer = fs.readFileSync(pdfPath);
        
        // 方法1: pdf-parseでテキスト抽出
        log('方法1: pdf-parseでテキスト抽出中...', 'info');
        const pdfData = await pdfParse(dataBuffer);
        log(`PDF情報を取得しました (${pdfData.numpages}ページ)`, 'success');
        
        // 方法2: pdf2jsonでテキスト抽出を試行
        log('方法2: pdf2jsonでテキスト抽出中...', 'info');
        let pdf2jsonText = '';
        try {
            pdf2jsonText = await extractTextWithPDF2JSON(pdfPath);
            log(`pdf2jsonでテキスト抽出完了 (${pdf2jsonText.length}文字)`, 'success');
        } catch (error) {
            log(`pdf2jsonでエラー: ${error.message}`, 'error');
        }
        
        // より多くのテキストを抽出できた方を使用
        const pdfParseText = pdfData.text;
        const extractedText = pdf2jsonText.length > pdfParseText.length ? pdf2jsonText : pdfParseText;
        const method = pdf2jsonText.length > pdfParseText.length ? 'pdf2json' : 'pdf-parse';
        
        log(`${method}を使用してテキスト抽出完了 (${extractedText.length}文字)`, 'success');
        
        return {
            extractedText,
            method,
            pdfPages: pdfData.numpages,
            rawPdfParseText: pdfParseText,
            rawPdf2jsonText: pdf2jsonText
        };
        
    } catch (error) {
        log(`PDF抽出中にエラーが発生しました: ${error.message}`, 'error');
        throw error;
    }
}

// PDFテキストを詳細解析してフォーム入力用のデータを抽出
function analyzePDFText(pdfText) {
    const lines = pdfText.split('\n').map(line => line.trim()).filter(line => line);
    
    const result = {
        fullText: pdfText,
        lines: lines,
        formData: {
            name: '',
            furigana: '',
            email: '',
            phone: '',
            address: '',
            birthDate: '',
            gender: '',
            currentCompany: '',
            education: [],
            workExperience: [],
            qualifications: []
        }
    };
    
    lines.forEach((line, index) => {
        // 氏名の抽出
        if (!result.formData.name) {
            const namePatterns = [
                /氏名[\s　]*([一-龯]{1,5}[\s　]+[一-龯]{1,5})/,
                /([一-龯]{1,5}[\s　]+[一-龯]{1,5})[\s　]*氏名/,
                /名前[\s：　]*([一-龯]{1,5}[\s　]*[一-龯]{1,5})/,
                index > 0 && lines[index - 1].includes('氏名') ? /^([一-龯]{1,5}[\s　]+[一-龯]{1,5})$/ : null
            ].filter(Boolean);
            
            for (const pattern of namePatterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    const name = match[1].replace(/[\s　]+/g, ' ').trim();
                    if (name.length >= 2 && name.length <= 10) {
                        result.formData.name = name;
                        break;
                    }
                }
            }
        }
        
        // ふりがなの抽出
        if (!result.formData.furigana) {
            const furiganaPatterns = [
                /ふりがな[\s　]*([あ-ん\s　]+)/,
                /フリガナ[\s　]*([ア-ン\s　]+)/,
                index > 0 && lines[index - 1].includes('ふりがな') ? /^([あ-ん\s　]+)$/ : null
            ].filter(Boolean);
            
            for (const pattern of furiganaPatterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    let furigana = match[1].replace(/[\s　]+/g, ' ').trim();
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
        
        // 電話番号
        if (!result.formData.phone) {
            const phonePatterns = [
                /(\d{2,4}[-－]\d{2,4}[-－]\d{4})/,
                /(\d{10,11})/,
                /電話[\s：　]*(\d{2,4}[-－]\d{2,4}[-－]\d{4})/,
                /TEL[\s：　]*(\d{2,4}[-－]\d{2,4}[-－]\d{4})/
            ];
            
            for (const pattern of phonePatterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    result.formData.phone = match[1];
                    break;
                }
            }
        }
        
        // メールアドレス
        if (!result.formData.email) {
            const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
            const match = line.match(emailPattern);
            if (match && match[1]) {
                result.formData.email = match[1];
            }
        }
        
        // 住所
        if (!result.formData.address) {
            const addressPattern = /((?:東京都|神奈川県|大阪府|京都府|北海道|[一-龯]{2,3}県)[一-龯市区町村\d\-\s　]+)/;
            const match = line.match(addressPattern);
            if (match && match[1]) {
                const address = match[1].trim();
                if (address.length >= 5) {
                    result.formData.address = address;
                }
            }
        }
        
        // 生年月日
        if (!result.formData.birthDate) {
            const birthPatterns = [
                /(\d{4})\s*年[\s　]*(\d{1,2})\s*月[\s　]*(\d{1,2})\s*日[\s　]*生/,
                /生年月日[\s　]*(\d{4})\s*年[\s　]*(\d{1,2})\s*月[\s　]*(\d{1,2})\s*日/,
                /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
                /(\d{4})-(\d{1,2})-(\d{1,2})/
            ];
            
            for (const pattern of birthPatterns) {
                const match = line.match(pattern);
                if (match && match[1] && match[2] && match[3]) {
                    const year = parseInt(match[1]);
                    const month = parseInt(match[2]);
                    const day = parseInt(match[3]);
                    
                    if (year >= 1900 && year <= new Date().getFullYear() && 
                        month >= 1 && month <= 12 && 
                        day >= 1 && day <= 31) {
                        
                        const formattedMonth = month.toString().padStart(2, '0');
                        const formattedDay = day.toString().padStart(2, '0');
                        result.formData.birthDate = `${year}/${formattedMonth}/${formattedDay}`;
                        break;
                    }
                }
            }
        }
        
        // 性別
        if (!result.formData.gender) {
            if ((line.includes('男') && !line.includes('女')) || line.includes('男性')) {
                if (line.length < 20) {
                    result.formData.gender = '男';
                }
            } else if ((line.includes('女') && !line.includes('男')) || line.includes('女性')) {
                if (line.length < 20) {
                    result.formData.gender = '女';
                }
            }
        }
        
        // 現在の会社
        if (!result.formData.currentCompany) {
            const companyPatterns = [
                /現職[\s：　]*([一-龯\w\s　]+(?:株式会社|会社|Corporation|Corp))/,
                /勤務先[\s：　]*([一-龯\w\s　]+(?:株式会社|会社|Corporation|Corp))/,
                /([一-龯\w\s　]+(?:株式会社|会社|Corporation|Corp))[\s　]*在籍/
            ];
            
            for (const pattern of companyPatterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    result.formData.currentCompany = match[1].trim();
                    break;
                }
            }
        }
    });
    
    return result;
}

// 履歴書データ抽出のメイン関数
async function extractResumeData(pdfPath, options = {}) {
    try {
        const pdfResult = await extractPDFText(pdfPath, options);
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
        throw new Error(`履歴書データ抽出エラー: ${error.message}`);
    }
}

module.exports = {
    extractPDFText,
    analyzePDFText,
    extractResumeData
}; 