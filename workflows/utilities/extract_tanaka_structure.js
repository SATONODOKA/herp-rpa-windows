const fs = require('fs');
const path = require('path');

async function extractTanakaStructure() {
    console.log('🔍 田中健太PDFの構造詳細分析...');
    
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const testFile = files.find(file => file.includes('rirekisho') || file.includes('健太'));
    
    const testPDF = path.join(pdfDir, testFile);
    
    try {
        const { extractPDFText } = require('./pdf_processing/pdf-extractor.js');
        
        const result = await extractPDFText(testPDF, {
            log: () => {}
        });
        
        const text = result.extractedText;
        
        // ページごとに分割して分析
        const pages = text.split(/--- ページ \d+ ---/);
        
        console.log(`📋 田中健太PDF構造分析 (${pages.length - 1}ページ):`);
        
        for (let i = 1; i < Math.min(pages.length, 6); i++) { // 最初の5ページを分析
            const pageContent = pages[i].trim();
            console.log(`\n--- ページ ${i} (${pageContent.length}文字) ---`);
            console.log('内容（最初の200文字）:');
            console.log(pageContent.substring(0, 200) + '...');
            
            // このページに含まれる重要な情報を特定
            const importantPatterns = [
                { name: '氏名', pattern: /田\s*中\s*健\s*太|タナカ\s*ケンタ/i },
                { name: '年齢', pattern: /\d+\s*歳/i },
                { name: '電話', pattern: /\d{2,4}-\d{3,4}-\d{4}/i },
                { name: 'メール', pattern: /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i },
                { name: '学校', pattern: /大学|学部|学科/i },
                { name: '会社', pattern: /株式会社|会社/i },
                { name: '年収', pattern: /\d{3,4}\s*万\s*円/i },
                { name: '推薦', pattern: /推薦|お勧め/i },
                { name: '履歴書', pattern: /履歴書/i },
                { name: '職務経歴', pattern: /職務|経歴/i }
            ];
            
            const foundPatterns = [];
            importantPatterns.forEach(({ name, pattern }) => {
                if (pattern.test(pageContent)) {
                    foundPatterns.push(name);
                }
            });
            
            if (foundPatterns.length > 0) {
                console.log(`重要な要素: ${foundPatterns.join(', ')}`);
            }
        }
        
        // 文字化けの確認
        console.log('\n🔍 文字化け確認:');
        const strangeChars = text.match(/[G▼■○□←→↑↓●⽇⼀⼆⼈⼊⼦⼿⼝⽕⽔]/g);
        if (strangeChars) {
            console.log(`文字化け文字数: ${strangeChars.length}`);
            console.log(`文字化け例: ${strangeChars.slice(0, 20).join('')}`);
        } else {
            console.log('文字化けは検出されませんでした');
        }
        
        // 文書の種類を特定
        console.log('\n📄 含まれる文書種類:');
        const docTypes = [
            { name: '推薦状', keywords: ['推薦状', '推薦理由', '面談所感'] },
            { name: '履歴書', keywords: ['履歴書', '学歴', '職歴', '志望動機'] },
            { name: '職務経歴書', keywords: ['職務経歴書', '職歴要約', '実績'] },
            { name: '求人票', keywords: ['求人情報', '募集要項', '給与'] },
            { name: '企業情報', keywords: ['企業概要', '会社概要', '事業内容'] }
        ];
        
        docTypes.forEach(({ name, keywords }) => {
            const found = keywords.some(keyword => text.includes(keyword));
            if (found) {
                console.log(`✅ ${name}: 含まれている`);
            } else {
                console.log(`❌ ${name}: 含まれていない`);
            }
        });
        
    } catch (error) {
        console.error('❌ 分析エラー:', error.message);
    }
}

extractTanakaStructure();