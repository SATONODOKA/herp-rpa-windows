const fs = require('fs');
const path = require('path');

async function testIwasakiFullText() {
    console.log('🧪 岩崎PDFファイル全文抽出テスト...');
    
    // 岩崎のPDFファイルを検索
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const testFile = files.find(file => file.includes('岩崎') || file.includes('å²©å´'));
    
    if (!testFile) {
        console.log('❌ 岩崎のPDFファイルが見つかりません');
        return;
    }
    
    const testPDF = path.join(pdfDir, testFile);
    console.log('📄 岩崎テストファイル:', testFile);
    
    try {
        // PDF抽出機能を使用
        const { extractPDFText } = require('./pdf_processing/pdf-extractor.js');
        
        const result = await extractPDFText(testPDF, {
            log: (message, type) => {
                // ログを簡潔にする
                if (type === 'success') {
                    console.log(`✅ ${message}`);
                }
            }
        });
        
        console.log('\n📊 岩崎PDF全文抽出結果:');
        console.log('  抽出方法:', result.method);
        console.log('  総文字数:', result.extractedText.length);
        console.log('\n📋 抽出された全テキスト:');
        console.log('=' + '='.repeat(100));
        console.log(result.extractedText);
        console.log('=' + '='.repeat(100));
        
        console.log('\n✅ 岩崎PDF全文抽出完了');
        
    } catch (error) {
        console.error('❌ 岩崎PDFテスト中にエラー:', error.message);
    }
}

testIwasakiFullText();