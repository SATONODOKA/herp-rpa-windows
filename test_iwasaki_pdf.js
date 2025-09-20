const fs = require('fs');
const path = require('path');

async function testIwasakiPDF() {
    console.log('🧪 岩崎PDFファイルテスト開始...');
    
    // 岩崎のPDFファイルを検索
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const testFile = files.find(file => file.includes('岩崎') || file.includes('å²©å´'));
    
    if (!testFile) {
        console.log('❌ 岩崎のPDFファイルが見つかりません');
        console.log('利用可能なファイル:');
        files.forEach(file => console.log('  -', file));
        return;
    }
    
    const testPDF = path.join(pdfDir, testFile);
    console.log('📄 岩崎テストファイル:', testFile);
    
    try {
        console.log('🔍 岩崎PDF読み取りテスト開始...');
        
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
        
        console.log('\n📊 岩崎PDF抽出結果:');
        console.log('  抽出方法:', result.method);
        console.log('  文字数:', result.extractedText.length);
        console.log('  テキスト（最初の1000文字）:');
        console.log('=' + '='.repeat(80));
        console.log(result.extractedText.substring(0, 1000));
        console.log('=' + '='.repeat(80));
        
        // 岩崎関連のキーワードを検索
        console.log('\n🔍 岩崎関連キーワード検索:');
        const keywords = ['岩崎', 'イワサキ', 'いわさき', 'Iwasaki'];
        keywords.forEach(keyword => {
            if (result.extractedText.includes(keyword)) {
                console.log(`✅ キーワード「${keyword}」が見つかりました`);
            } else {
                console.log(`❌ キーワード「${keyword}」は見つかりませんでした`);
            }
        });
        
        console.log('\n✅ 岩崎PDFテスト完了');
        
    } catch (error) {
        console.error('❌ 岩崎PDFテスト中にエラー:', error.message);
    }
}

testIwasakiPDF();