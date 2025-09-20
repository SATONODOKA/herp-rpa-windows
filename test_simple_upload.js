const fs = require('fs');
const path = require('path');

async function testSimpleUpload() {
    console.log('🧪 シンプルPDFアップロードテスト開始...');
    
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
        console.log('📤 サーバーにPOSTリクエスト送信中...');
        
        // ローカルでPDF処理をテスト
        const { SimplePDFExtractor } = require('./pdf_processing/simple-pdf-extractor.js');
        const extractor = new SimplePDFExtractor();
        
        console.log('🔍 ローカルPDF処理テスト開始...');
        
        // 推薦状形式で抽出を試行
        console.log('📋 推薦状形式での抽出を試行中...');
        const recommendationResult = await extractor.extractRecommendationData(testPDF);
        
        // 履歴書形式で抽出を試行
        console.log('📋 履歴書形式での抽出を試行中...');
        const resumeResult = await extractor.extractTextFromPDF(testPDF);
        
        // どちらか成功した結果を使用
        let result;
        if (recommendationResult.success) {
            result = {
                success: true,
                formatType: 'recommendation',
                unifiedData: {
                    name: recommendationResult.herpMapping?.name,
                    age: recommendationResult.herpMapping?.age,
                    phone: recommendationResult.herpMapping?.phone,
                    email: recommendationResult.herpMapping?.email,
                    currentCompany: recommendationResult.herpMapping?.company,
                    finalEducation: recommendationResult.herpMapping?.education
                }
            };
        } else if (resumeResult.success) {
            result = {
                success: true,
                formatType: 'resume',
                unifiedData: {
                    name: resumeResult.extractedName,
                    age: resumeResult.age,
                    phone: resumeResult.phone,
                    email: resumeResult.email,
                    currentCompany: resumeResult.currentCompany?.company,
                    finalEducation: resumeResult.finalEducation?.education
                }
            };
        } else {
            result = {
                success: false,
                error: `推薦状形式: ${recommendationResult.error}, 履歴書形式: ${resumeResult.error}`
            };
        }
        
        if (result.success) {
            console.log('✅ ローカル処理成功!');
            console.log('📊 抽出データ:');
            console.log('  氏名:', result.unifiedData.name);
            console.log('  年齢:', result.unifiedData.age);
            console.log('  電話:', result.unifiedData.phone);
            console.log('  Email:', result.unifiedData.email);
            console.log('  現所属:', result.unifiedData.currentCompany);
            console.log('  最終学歴:', result.unifiedData.finalEducation);
            console.log('  フォーマット:', result.formatType);
        } else {
            console.log('❌ ローカル処理失敗:', result.error);
        }
        
    } catch (error) {
        console.error('❌ テスト中にエラー:', error.message);
    }
}

testSimpleUpload();