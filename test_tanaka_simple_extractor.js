const fs = require('fs');
const path = require('path');

async function testTanakaSimpleExtractor() {
    console.log('🧪 kyujinshogoブランチのSimplePDFExtractorで田中PDFをテスト...');
    
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const tanakaFile = files.find(file => file.includes('rirekisho') || file.includes('健太'));
    
    if (!tanakaFile) {
        console.log('❌ 田中PDFファイルが見つかりません');
        return;
    }
    
    const testPDF = path.join(pdfDir, tanakaFile);
    console.log('📄 田中テストファイル:', tanakaFile);
    
    try {
        const { SimplePDFExtractor } = require('./pdf_processing/simple-pdf-extractor.js');
        const extractor = new SimplePDFExtractor();
        
        const result = await extractor.extractTextFromPDF(testPDF);
        
        console.log('\n📊 SimplePDFExtractor 抽出結果:');
        console.log('  成功:', result.success);
        console.log('  方法:', result.method);
        console.log('  信頼度:', result.confidence + '%');
        
        console.log('\n👤 抽出された個人情報:');
        console.log('  氏名:', result.extractedName || '未抽出');
        console.log('  フリガナ:', result.furigana || '未抽出');
        console.log('  年齢:', result.age ? result.age + '歳' : '未抽出');
        console.log('  電話:', result.phone || '未抽出');
        console.log('  メール:', result.email || '未抽出');
        console.log('  現所属:', result.currentCompany?.company || '未抽出');
        console.log('  最終学歴:', result.finalEducation?.education || '未抽出');
        
        if (result.recommendationComment) {
            console.log('\n📝 推薦時コメント:');
            console.log(result.recommendationComment.substring(0, 200) + '...');
        }
        
        if (result.careerSummary) {
            console.log('\n💼 職務要約:');
            console.log(result.careerSummary.substring(0, 200) + '...');
        }
        
        console.log('\n✅ SimplePDFExtractor テスト完了');
        
    } catch (error) {
        console.error('❌ テスト中にエラー:', error.message);
    }
}

testTanakaSimpleExtractor();