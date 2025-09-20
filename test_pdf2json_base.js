const fs = require('fs');
const path = require('path');

async function testPDF2JSONBase() {
    console.log('🧪 PDF2JSON基本機能テスト開始...');
    
    // 利用可能なPDFファイルを検索
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const testFile = files.find(file => file.includes('rirekisho') || file.includes('健太'));
    
    if (!testFile) {
        console.log('❌ テスト用PDFファイルが見つかりません');
        return;
    }
    
    const testPDF = path.join(pdfDir, testFile);
    console.log('📄 テストファイル:', testFile);
    
    try {
        console.log('🔍 PDF2JSON基本機能テスト開始...');
        
        // PDF抽出機能を使用
        const { extractPDFText } = require('./pdf_processing/pdf-extractor.js');
        
        const result = await extractPDFText(testPDF, {
            log: (message, type) => {
                const emoji = {
                    'info': '📋',
                    'success': '✅',
                    'error': '❌'
                };
                console.log(`${emoji[type]} ${message}`);
            }
        });
        
        console.log('\n📊 抽出結果:');
        console.log('  抽出方法:', result.method);
        console.log('  文字数:', result.extractedText.length);
        console.log('  テキスト（最初の500文字）:');
        console.log('=' + '='.repeat(60));
        console.log(result.extractedText.substring(0, 500));
        console.log('=' + '='.repeat(60));
        
        console.log('\n✅ PDF2JSON基本機能テスト完了');
        
    } catch (error) {
        console.error('❌ テスト中にエラー:', error.message);
    }
}

testPDF2JSONBase();