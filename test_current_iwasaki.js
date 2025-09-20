const fs = require('fs');
const path = require('path');

async function testCurrentIwasaki() {
    console.log('🔍 現在のpdf-extractor.jsで岩崎PDFを読み取りテスト...');
    
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const iwasakiFile = files.find(file => file.includes('0813_0041'));
    
    if (!iwasakiFile) {
        console.log('❌ 岩崎PDFファイルが見つかりません');
        console.log('利用可能ファイル:', files);
        return;
    }
    
    const testPDF = path.join(pdfDir, iwasakiFile);
    console.log('📄 テストファイル:', iwasakiFile);
    
    try {
        const { extractPDFText, analyzePDFText } = require('./pdf_processing/pdf-extractor.js');
        
        // PDF抽出
        const result = await extractPDFText(testPDF, {
            log: (message, type) => console.log(`[${type}] ${message}`)
        });
        
        console.log('\n📊 抽出結果:');
        console.log('  方法:', result.method);
        console.log('  文字数:', result.extractedText.length);
        console.log('  ページ数:', result.pdfPages);
        
        // データ解析
        const analyzed = analyzePDFText(result.extractedText);
        
        console.log('\n📋 解析結果:');
        console.log('  氏名:', analyzed.formData.name || '未抽出');
        console.log('  ふりがな:', analyzed.formData.furigana || '未抽出');
        console.log('  電話:', analyzed.formData.phone || '未抽出');
        console.log('  メール:', analyzed.formData.email || '未抽出');
        console.log('  住所:', analyzed.formData.address || '未抽出');
        console.log('  生年月日:', analyzed.formData.birthDate || '未抽出');
        console.log('  性別:', analyzed.formData.gender || '未抽出');
        console.log('  現職:', analyzed.formData.currentCompany || '未抽出');
        
        // 抽出できたテキストの最初の500文字を確認
        console.log('\n📝 抽出テキスト（最初の500文字）:');
        console.log(result.extractedText.substring(0, 500) + '...');
        
        console.log('\n✅ 岩崎PDF読み取りテスト完了');
        
    } catch (error) {
        console.error('❌ エラー:', error.message);
    }
}

testCurrentIwasaki();