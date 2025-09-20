const fs = require('fs');
const path = require('path');

async function extractHERPFields() {
    console.log('🔍 田中健太PDFからHERP項目一覧を抽出...');
    
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const testFile = files.find(file => file.includes('rirekisho') || file.includes('健太'));
    
    if (!testFile) {
        console.log('❌ 田中健太のPDFファイルが見つかりません');
        return;
    }
    
    const testPDF = path.join(pdfDir, testFile);
    console.log('📄 田中健太テストファイル:', testFile);
    
    try {
        const { extractPDFText } = require('./pdf_processing/pdf-extractor.js');
        
        const result = await extractPDFText(testPDF, {
            log: () => {} // ログを無効化
        });
        
        console.log('\n📋 田中健太PDF全文:');
        console.log('=' + '='.repeat(100));
        console.log(result.extractedText);
        console.log('=' + '='.repeat(100));
        
    } catch (error) {
        console.error('❌ エラー:', error.message);
    }
}

extractHERPFields();