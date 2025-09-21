const fs = require('fs');
const path = require('path');

async function analyzeTanakaHERPMapping() {
    console.log('🔍 田中健太PDFの18項目対応分析...');
    
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
        
        console.log('\n📊 田中健太PDF概要:');
        console.log('  総文字数:', result.extractedText.length);
        console.log('  抽出方法:', result.method);
        
        // 文書構成を分析
        const text = result.extractedText;
        console.log('\n📋 文書構成分析:');
        
        // ページ数をカウント
        const pageMatches = text.match(/--- ページ \d+ ---/g);
        console.log('  ページ数:', pageMatches ? pageMatches.length : '不明');
        
        // 主要セクションを特定
        const sections = [
            '推薦状', '履歴書', '職務経歴書', '求人情報', 
            'キャリアパス', '企業概要', '選考内容'
        ];
        
        sections.forEach(section => {
            if (text.includes(section)) {
                console.log(`  ✅ ${section}セクション: 含まれている`);
            }
        });
        
        // HERP 18項目に対応する可能性があるキーワードを検索
        console.log('\n🎯 HERP項目対応キーワード検索:');
        
        const herpKeywords = [
            { item: '1. 応募者氏名', keywords: ['田中', '健太', '氏名', 'タナカ', 'ケンタ'] },
            { item: '2. 現所属', keywords: ['株式会社', '会社', '現職', 'フィンテック', 'ソリューションズ'] },
            { item: '3. 年齢', keywords: ['25歳', '年齢', '満'] },
            { item: '4. 最終学歴', keywords: ['早稲田大学', '商学部', '経営学科', '大学', '卒業'] },
            { item: '5. 電話番号', keywords: ['080-1234-5678', '電話', '携帯'] },
            { item: '6. メールアドレス', keywords: ['k.tanaka.sales@outlook.jp', 'メール', '@'] },
            { item: '7. 推薦時コメント', keywords: ['推薦理由', '面談所感', 'お勧め', '積極的'] },
            { item: '11. 経歴', keywords: ['職歴', '職務経歴', 'テックイノベーション', 'チームリーダー'] },
            { item: '13. 現年収', keywords: ['年収', '万円', '給与', '月収'] }
        ];
        
        herpKeywords.forEach(({ item, keywords }) => {
            const found = keywords.filter(keyword => text.includes(keyword));
            if (found.length > 0) {
                console.log(`  ✅ ${item}: ${found.join(', ')}`);
            } else {
                console.log(`  ❌ ${item}: キーワード未発見`);
            }
        });
        
        // 特定のデータを抽出してみる
        console.log('\n📝 具体的なデータ抽出:');
        
        // 氏名抽出
        const nameMatches = text.match(/田\s*中\s*健\s*太/g);
        if (nameMatches) {
            console.log(`  氏名: 「田中健太」が${nameMatches.length}回出現`);
        }
        
        // 年齢抽出
        const ageMatches = text.match(/25\s*歳/g);
        if (ageMatches) {
            console.log(`  年齢: 「25歳」が${ageMatches.length}回出現`);
        }
        
        // メールアドレス抽出
        const emailMatches = text.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (emailMatches) {
            console.log('  メールアドレス:', emailMatches[0]);
        }
        
        // 電話番号抽出
        const phoneMatches = text.match(/080-1234-5678/g);
        if (phoneMatches) {
            console.log(`  電話番号: 「080-1234-5678」が${phoneMatches.length}回出現`);
        }
        
        // 年収情報抽出
        const salaryMatches = text.match(/(\d{3,4})\s*万\s*円/g);
        if (salaryMatches) {
            console.log('  年収関連:', salaryMatches.slice(0, 5).join(', '));
        }
        
        console.log('\n✅ 田中健太PDF分析完了');
        
    } catch (error) {
        console.error('❌ 分析中にエラー:', error.message);
    }
}

analyzeTanakaHERPMapping();