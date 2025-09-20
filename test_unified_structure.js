const { SimplePDFExtractor } = require('./pdf_processing/simple-pdf-extractor.js');
const fs = require('fs');
const path = require('path');

async function testUnifiedStructure() {
    const extractor = new SimplePDFExtractor();
    
    // PDFディレクトリからテストファイルを動的に検索
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    
    // 最新のrirekisho.pdfを検索
    const rirekishoFile = files.filter(file => file.includes('rirekisho')).pop();
    
    if (!rirekishoFile) {
        console.log('❌ rirekisho.pdfファイルが見つかりません');
        return;
    }
    
    const testPDF = path.join(pdfDir, rirekishoFile);
    console.log('📄 テストファイル:', rirekishoFile);
    
    try {
        console.log('🔍 統一データ構造テスト開始...');
        
        // 新しい統一メソッドを使用
        const result = await extractor.extractDataWithFormatDetection(testPDF);
        
        if (result.success) {
            console.log('✅ 抽出成功!');
            console.log('\n📊 統一データ構造:');
            console.log('formatType:', result.formatType);
            console.log('unifiedData:', result.unifiedData);
            
            console.log('\n📄 詳細データ:');
            console.log('name:', result.unifiedData.name);
            console.log('currentCompany:', result.unifiedData.currentCompany);
            console.log('age:', result.unifiedData.age);
            console.log('finalEducation:', result.unifiedData.finalEducation);
            console.log('phone:', result.unifiedData.phone);
            console.log('email:', result.unifiedData.email);
            console.log('currentSalary:', result.unifiedData.currentSalary);
        } else {
            console.log('❌ 抽出失敗:', result.error);
        }
        
    } catch (error) {
        console.error('❌ テスト中にエラー:', error.message);
    }
}

testUnifiedStructure();