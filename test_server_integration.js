const FormData = require('form-data');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

async function testServerIntegration() {
    console.log('🧪 サーバー統合テスト開始...');
    
    // 利用可能なPDFファイルを検索
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const testFile = files.find(file => file.includes('岩田') || file.includes('0813'));
    
    if (!testFile) {
        console.log('❌ テスト用PDFファイルが見つかりません');
        return;
    }
    
    const testPDF = path.join(pdfDir, testFile);
    console.log('📄 テストファイル:', testFile);
    
    try {
        // FormDataを作成してPDFをアップロード
        const form = new FormData();
        form.append('pdf', fs.createReadStream(testPDF));
        
        console.log('📤 PDFアップロード中...');
        const response = await fetch('http://localhost:3001/upload-pdf', {
            method: 'POST',
            body: form
        });
        
        const result = await response.json();
        
        if (response.ok) {
            console.log('✅ アップロード成功!');
            console.log('📊 レスポンス:', JSON.stringify(result, null, 2));
        } else {
            console.log('❌ アップロード失敗:', result);
        }
        
    } catch (error) {
        console.error('❌ テスト中にエラー:', error.message);
    }
}

testServerIntegration();