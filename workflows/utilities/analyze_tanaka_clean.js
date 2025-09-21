const fs = require('fs');
const path = require('path');

async function analyzeTanakaClean() {
    console.log('🔍 田中健太PDF（文字化け除去後）の18項目対応分析...');
    
    const pdfDir = "/Users/satonodoka/Desktop/herpkyujinshutoku/uploads/pdfs/";
    const files = fs.readdirSync(pdfDir);
    const testFile = files.find(file => file.includes('rirekisho') || file.includes('健太'));
    
    const testPDF = path.join(pdfDir, testFile);
    
    try {
        const { extractPDFText } = require('./pdf_processing/pdf-extractor.js');
        
        const result = await extractPDFText(testPDF, {
            log: () => {}
        });
        
        // 文字化け文字を除去
        let cleanText = result.extractedText
            .replace(/[G▼■○□←→↑↓●⽇⼀⼆⼈⼊⼦⼿⼝⽕⽔]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        console.log(`📊 文字化け除去前: ${result.extractedText.length}文字`);
        console.log(`📊 文字化け除去後: ${cleanText.length}文字`);
        
        // 18項目対応データを抽出
        console.log('\n🎯 HERP 18項目対応データ抽出:');
        
        // 1. 応募者氏名
        const namePatterns = [
            /田\s*中\s*健\s*太/,
            /タナカ\s*ケンタ/,
            /氏\s*名\s*[：:]\s*(.+)/
        ];
        let name = null;
        namePatterns.forEach(pattern => {
            const match = cleanText.match(pattern);
            if (match && !name) {
                name = match[0] || match[1];
                console.log(`1. 応募者氏名: ${name}`);
            }
        });
        if (!name) console.log('1. 応募者氏名: 未発見');
        
        // 2. 現所属
        const companyPatterns = [
            /株式会社\s*フィンテック\s*ソリューションズ/,
            /テックイノベーション/,
            /現所属[：:]\s*(.+)/
        ];
        let company = null;
        companyPatterns.forEach(pattern => {
            const match = cleanText.match(pattern);
            if (match && !company) {
                company = match[0] || match[1];
                console.log(`2. 現所属: ${company}`);
            }
        });
        if (!company) console.log('2. 現所属: 未発見');
        
        // 3. 年齢
        const agePattern = /(\d+)\s*歳/;
        const ageMatch = cleanText.match(agePattern);
        if (ageMatch) {
            console.log(`3. 年齢: ${ageMatch[1]}歳`);
        } else {
            console.log('3. 年齢: 未発見');
        }
        
        // 4. 最終学歴
        const educationPatterns = [
            /早稲田大学\s*商学部\s*経営学科/,
            /青山学院高等学校/,
            /大学.+学部.+学科/
        ];
        let education = null;
        educationPatterns.forEach(pattern => {
            const match = cleanText.match(pattern);
            if (match && !education) {
                education = match[0];
                console.log(`4. 最終学歴: ${education}`);
            }
        });
        if (!education) console.log('4. 最終学歴: 未発見');
        
        // 5. 電話番号
        const phonePattern = /(\d{2,4}-\d{3,4}-\d{4})/;
        const phoneMatch = cleanText.match(phonePattern);
        if (phoneMatch) {
            console.log(`5. 電話番号: ${phoneMatch[1]}`);
        } else {
            console.log('5. 電話番号: 未発見');
        }
        
        // 6. メールアドレス
        const emailPattern = /([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
        const emailMatch = cleanText.match(emailPattern);
        if (emailMatch) {
            console.log(`6. メールアドレス: ${emailMatch[1]}`);
        } else {
            console.log('6. メールアドレス: 未発見');
        }
        
        // 7. 推薦時コメント
        const recommendationPatterns = [
            /推薦理由[：:](.{50,200})/,
            /面談所感[：:](.{50,200})/,
            /お勧めできる人材(.{20,100})/
        ];
        let recommendation = null;
        recommendationPatterns.forEach(pattern => {
            const match = cleanText.match(pattern);
            if (match && !recommendation) {
                recommendation = match[1] || match[0];
                console.log(`7. 推薦時コメント: ${recommendation.substring(0, 100)}...`);
            }
        });
        if (!recommendation) console.log('7. 推薦時コメント: 未発見');
        
        // 11. 経歴
        const careerKeywords = ['職務経歴', '営業', 'チームリーダー', '法人営業'];
        const careerFound = careerKeywords.filter(keyword => cleanText.includes(keyword));
        if (careerFound.length > 0) {
            console.log(`11. 経歴: ${careerFound.join(', ')} 等のキーワード発見`);
        } else {
            console.log('11. 経歴: 未発見');
        }
        
        // 13. 現年収
        const salaryPattern = /(\d{3,4})\s*万\s*円/g;
        const salaryMatches = [];
        let match;
        while ((match = salaryPattern.exec(cleanText)) !== null) {
            salaryMatches.push(match[1] + '万円');
        }
        if (salaryMatches.length > 0) {
            console.log(`13. 現年収候補: ${salaryMatches.slice(0, 5).join(', ')}`);
        } else {
            console.log('13. 現年収: 未発見');
        }
        
        // 文書の種類を再確認
        console.log('\n📄 含まれる文書種類（文字化け除去後）:');
        const docTypes = [
            { name: '推薦状', keywords: ['推薦状', '推薦理由', '面談所感'] },
            { name: '履歴書', keywords: ['履歴書', '学歴', '職歴'] },
            { name: '職務経歴書', keywords: ['職務経歴書', '職歴要約'] },
            { name: '求人票', keywords: ['求人情報', '三井住友銀行'] },
            { name: '企業情報', keywords: ['企業概要', '事業内容'] }
        ];
        
        docTypes.forEach(({ name, keywords }) => {
            const found = keywords.some(keyword => cleanText.includes(keyword));
            if (found) {
                const foundKeywords = keywords.filter(keyword => cleanText.includes(keyword));
                console.log(`✅ ${name}: ${foundKeywords.join(', ')}`);
            } else {
                console.log(`❌ ${name}: 未発見`);
            }
        });
        
    } catch (error) {
        console.error('❌ 分析エラー:', error.message);
    }
}

analyzeTanakaClean();