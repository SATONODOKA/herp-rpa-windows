const fs = require('fs');
const pdfParse = require('pdf-parse');

/**
 * pdf-parseを使用したシンプルなPDF文字抽出
 */
class SimplePDFExtractor {
    constructor() {
        this.debug = true;
    }

    /**
     * PDFから直接文字を抽出
     */
    async extractTextFromPDF(pdfPath) {
        try {
            console.log('📄 pdf-parseを使用してPDFテキストを抽出します...');
            
            const dataBuffer = fs.readFileSync(pdfPath);
            const data = await pdfParse(dataBuffer);
            
            console.log('📊 PDF情報:');
            console.log(`  - ページ数: ${data.numpages}`);
            console.log(`  - 総文字数: ${data.text.length}`);
            
            // 最初の1000文字を表示（デバッグ用）
            if (this.debug) {
                console.log('\n📋 抽出されたテキスト（最初の1000文字）:');
                console.log('=' + '='.repeat(60));
                console.log(data.text.substring(0, 1000));
                console.log('=' + '='.repeat(60));
            }
            
            // 各種データを抽出
            const nameResult = this.extractNameFromText(data.text);
            const ageResult = this.extractAgeFromText(data.text);
            const phoneResult = this.extractPhoneFromText(data.text);
            const emailResult = this.extractEmailFromText(data.text);
            const recommendationCommentResult = this.extractRecommendationCommentFromText(data.text);
            const careerSummaryResult = this.extractCareerSummaryFromText(data.text);
            
            return {
                success: true,
                fullText: data.text,
                extractedName: nameResult.name,
                furigana: nameResult.furigana,
                age: ageResult.age,
                phone: phoneResult.phone,
                email: emailResult.email,
                recommendationComment: recommendationCommentResult.comment,
                careerSummary: careerSummaryResult.summary,
                confidence: Math.max(
                    nameResult.confidence, 
                    ageResult.confidence, 
                    phoneResult.confidence, 
                    emailResult.confidence,
                    recommendationCommentResult.confidence,
                    careerSummaryResult.confidence
                ),
                method: 'pdf-parse-simple'
            };
            
        } catch (error) {
            console.error('❌ PDF抽出エラー:', error.message);
            return {
                success: false,
                error: error.message,
                fullText: null,
                extractedName: null,
                furigana: null,
                confidence: 0
            };
        }
    }

    /**
     * テキストから氏名を抽出
     */
    extractNameFromText(text) {
        console.log('\n🔍 テキストから氏名を抽出します...');
        
        // テキストを行に分割
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
                 if (this.debug) {
             console.log('\n📝 テキストの行分割（最初の20行）:');
             lines.slice(0, 20).forEach((line, index) => {
                 console.log(`${String(index + 1).padStart(2)}. "${line}"`);
             });
         }
        
        // 氏名を探すパターン
        let nameCandidate = null;
        let furiganaCandidate = null;
        
        // パターン1: 「氏名」ラベルの後
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('氏名') || line.includes('名前')) {
                console.log(`🏷️ 氏名ラベル発見: "${line}"`);
                
                // 同じ行に氏名がある場合
                const nameInSameLine = this.extractNameFromLine(line);
                if (nameInSameLine) {
                    nameCandidate = nameInSameLine;
                    console.log(`✅ 同じ行で氏名発見: "${nameCandidate}"`);
                    break;
                }
                
                // 次の行を確認
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    const nameInNextLine = this.extractNameFromLine(nextLine);
                    if (nameInNextLine) {
                        nameCandidate = nameInNextLine;
                        console.log(`✅ 次の行で氏名発見: "${nameCandidate}"`);
                        break;
                    }
                }
            }
        }
        
                 // パターン2: フリガナを探す（氏名が見つかっていても実行）
         for (let i = 0; i < lines.length; i++) {
             const line = lines[i];
             
             if (line.includes('フリガナ') || line.includes('ふりがな')) {
                 console.log(`📝 フリガナラベル発見: "${line}"`);
                 
                 // 同じ行にフリガナがある場合
                 const furiganaInLine = this.extractFuriganaFromLine(line);
                 if (furiganaInLine) {
                     furiganaCandidate = furiganaInLine;
                     console.log(`✅ 同じ行でフリガナ発見: "${furiganaCandidate}"`);
                     break;
                 }
                 
                 // 次の行でフリガナ
                 if (i + 1 < lines.length) {
                     const nextLine = lines[i + 1];
                     const furiganaInNextLine = this.extractFuriganaFromLine(nextLine);
                     if (furiganaInNextLine) {
                         furiganaCandidate = furiganaInNextLine;
                         console.log(`✅ 次の行でフリガナ発見: "${furiganaCandidate}"`);
                         break;
                     }
                     
                     // その次の行で氏名（まだ見つかっていない場合）
                     if (!nameCandidate && i + 2 < lines.length) {
                         const nameLineCandidate = lines[i + 2];
                         const nameFromFuriganaSection = this.extractNameFromLine(nameLineCandidate);
                         if (nameFromFuriganaSection) {
                             nameCandidate = nameFromFuriganaSection;
                             console.log(`✅ フリガナセクションで氏名発見: "${nameCandidate}"`);
                         }
                     }
                 }
             }
         }
        
        // パターン3: 一般的な日本語名のパターンを探す
        if (!nameCandidate) {
            console.log('🔍 一般的な日本語名パターンを検索します...');
            
            for (const line of lines) {
                const generalName = this.findJapaneseNamePattern(line);
                if (generalName) {
                    nameCandidate = generalName;
                    console.log(`✅ 一般パターンで氏名発見: "${nameCandidate}"`);
                    break;
                }
            }
        }
        
        const confidence = this.calculateConfidence(nameCandidate, furiganaCandidate);
        
        return {
            name: nameCandidate,
            furigana: furiganaCandidate,
            confidence: confidence
        };
    }

    /**
     * 行から氏名を抽出
     */
    extractNameFromLine(line) {
        // 氏名ラベルを除去
        let cleanLine = line.replace(/氏名|名前|:|：/g, '').trim();
        
        // 日本語の氏名パターン
        const patterns = [
            // 田中　健太（全角スペース）
            /([一-龯]{1,4})[\s　]+([一-龯]{1,4})/,
            // 田中健太（スペースなし、4文字）
            /^([一-龯]{2})([一-龯]{2})$/,
            // 田中健太（スペースなし、3文字）
            /^([一-龯]{1})([一-龯]{2})$/
        ];
        
        for (const pattern of patterns) {
            const match = cleanLine.match(pattern);
            if (match) {
                if (match[1] && match[2]) {
                    return `${match[1]} ${match[2]}`;
                }
            }
        }
        
        // 単純な日本語文字のみの場合
        if (/^[一-龯]{2,6}$/.test(cleanLine)) {
            // 4文字の場合は2文字ずつに分割
            if (cleanLine.length === 4) {
                return `${cleanLine.substring(0, 2)} ${cleanLine.substring(2)}`;
            }
            // 3文字の場合は1文字目と残りに分割
            if (cleanLine.length === 3) {
                return `${cleanLine.substring(0, 1)} ${cleanLine.substring(1)}`;
            }
            return cleanLine;
        }
        
        return null;
    }

    /**
     * 行からフリガナを抽出
     */
    extractFuriganaFromLine(line) {
        // フリガナラベルを除去
        let cleanLine = line.replace(/フリガナ|ふりがな|:|：/g, '').trim();
        
        // カタカナパターン（スペース区切りも考慮）
        const katakanaMatch = cleanLine.match(/[ア-ン]+(?:\s+[ア-ン]+)*/);
        if (katakanaMatch) {
            const katakana = katakanaMatch[0].trim();
            console.log(`📝 カタカナフリガナ発見: "${katakana}"`);
            
            // カタカナをひらがなに変換
            const hiragana = katakana.replace(/[ア-ン]/g, (char) => 
                String.fromCharCode(char.charCodeAt(0) - 0x60)
            ).replace(/\s+/g, ' '); // スペースを正規化
            
            return hiragana;
        }
        
        // ひらがなパターン
        const hiraganaMatch = cleanLine.match(/[あ-ん]+(?:\s+[あ-ん]+)*/);
        if (hiraganaMatch) {
            console.log(`📝 ひらがなフリガナ発見: "${hiraganaMatch[0]}"`);
            return hiraganaMatch[0].trim().replace(/\s+/g, ' ');
        }
        
        return null;
    }

    /**
     * 一般的な日本語名パターンを探す
     */
    findJapaneseNamePattern(line) {
        // 除外する単語
        const excludeWords = ['推薦', '理由', '登録', '職種', '会社', '銀行', '営業', '統合', '文書', '履歴書'];
        
        if (excludeWords.some(word => line.includes(word))) {
            return null;
        }
        
        // 田中健太のような4文字の日本語
        const fourCharMatch = line.match(/([一-龯]{2})[\s　]*([一-龯]{2})/);
        if (fourCharMatch) {
            return `${fourCharMatch[1]} ${fourCharMatch[2]}`;
        }
        
        // 3文字の場合
        const threeCharMatch = line.match(/([一-龯]{1})[\s　]*([一-龯]{2})/);
        if (threeCharMatch) {
            return `${threeCharMatch[1]} ${threeCharMatch[2]}`;
        }
        
        return null;
    }

    /**
     * テキストから年齢を抽出
     */
    extractAgeFromText(text) {
        console.log('\n🔍 テキストから年齢を抽出します...');
        
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        let ageCandidate = null;
        let confidence = 0;
        
        for (const line of lines) {
            // 満xx歳のパターン
            const agePatterns = [
                /満(\d{1,2})歳/,           // 満25歳
                /\(満(\d{1,2})歳\)/,      // (満25歳)
                /（満(\d{1,2})歳）/,      // （満25歳）
                /満\s*(\d{1,2})\s*歳/,   // 満 25 歳
                /(\d{1,2})歳\s*男/,       // 25歳 男
                /(\d{1,2})歳\s*女/        // 25歳 女
            ];
            
            for (const pattern of agePatterns) {
                const match = line.match(pattern);
                if (match) {
                    const age = parseInt(match[1]);
                    if (age >= 15 && age <= 80) { // 妥当な年齢範囲
                        ageCandidate = age;
                        confidence = 95;
                        console.log(`✅ 年齢発見: "${line}" → ${age}歳`);
                        break;
                    }
                }
            }
            
            if (ageCandidate) break;
        }
        
        if (!ageCandidate) {
            console.log('⚠️ 年齢が見つかりませんでした');
        }
        
        return {
            age: ageCandidate,
            confidence: confidence
        };
    }

    /**
     * テキストから電話番号を抽出
     */
    extractPhoneFromText(text) {
        console.log('\n🔍 テキストから電話番号を抽出します...');
        
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        let phoneCandidate = null;
        let confidence = 0;
        
        for (const line of lines) {
            // 電話番号のパターン（より厳密に）
            const phonePatterns = [
                /電話[：:\s]*(\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4})/, // 電話 080-1234-5678
                /TEL[：:\s]*(\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4})/,  // TEL: 080-1234-5678
                /(0\d{1,3}[-\s]?\d{2,4}[-\s]?\d{4})/,          // 080-1234-5678, 03-1234-5678 (0で始まる)
                /(0\d{9,10})/                                   // 08012345678 (0で始まる10-11桁)
            ];
            
            for (const pattern of phonePatterns) {
                const match = line.match(pattern);
                if (match) {
                    let phone = match[1];
                    
                    // 電話番号の妥当性チェック
                    const cleanPhone = phone.replace(/[-\s]/g, '');
                    
                    // 日本の電話番号は10桁または11桁で0で始まる
                    if (!/^0\d{9,10}$/.test(cleanPhone)) {
                        continue; // 無効な電話番号はスキップ
                    }
                    
                    // 数字のみの場合はハイフンを追加
                    if (/^\d{10,11}$/.test(phone)) {
                        if (phone.length === 11) {
                            // 080-1234-5678 形式
                            phone = phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
                        } else if (phone.length === 10) {
                            // 03-1234-5678 形式
                            phone = phone.replace(/(\d{2,3})(\d{4})(\d{4})/, '$1-$2-$3');
                        }
                    }
                    
                    phoneCandidate = phone;
                    confidence = 90;
                    console.log(`✅ 電話番号発見: "${line}" → ${phone}`);
                    break;
                }
            }
            
            if (phoneCandidate) break;
        }
        
        if (!phoneCandidate) {
            console.log('⚠️ 電話番号が見つかりませんでした');
        }
        
        return {
            phone: phoneCandidate,
            confidence: confidence
        };
    }

    /**
     * テキストから メールアドレスを抽出
     */
    extractEmailFromText(text) {
        console.log('\n🔍 テキストからメールアドレスを抽出します...');
        
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        let emailCandidate = null;
        let confidence = 0;
        
        for (const line of lines) {
            // メールアドレスのパターン（@を含む）
            const emailPatterns = [
                /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,  // 標準的なメールアドレス
                /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/                  // ドメイン部分が短い場合
            ];
            
            for (const pattern of emailPatterns) {
                const match = line.match(pattern);
                if (match) {
                    emailCandidate = match[1];
                    confidence = 95;
                    console.log(`✅ メールアドレス発見: "${line}" → ${emailCandidate}`);
                    break;
                }
            }
            
            if (emailCandidate) break;
        }
        
        if (!emailCandidate) {
            console.log('⚠️ メールアドレスが見つかりませんでした');
        }
        
        return {
            email: emailCandidate,
            confidence: confidence
        };
    }

    /**
     * テキストから推薦時コメントを抽出
     */
    extractRecommendationCommentFromText(text) {
        console.log('\n🔍 テキストから推薦時コメントを抽出します...');
        
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        let commentCandidate = null;
        let confidence = 0;
        
        // 「推薦理由」セクションを探す
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // 推薦理由のラベルを検出
            if (line.includes('推薦理由')) {
                console.log(`📝 推薦理由ラベル発見: "${line}"`);
                
                // 推薦理由の後のコンテンツを収集
                const commentLines = [];
                let j = i + 1;
                
                // 「面談所感」が出現するまで、または適切な終了条件まで収集
                while (j < lines.length) {
                    const currentLine = lines[j];
                    
                    // 終了条件: 面談所感、転職理由、添付資料などが出現
                    if (currentLine.includes('面談所感') || 
                        currentLine.includes('転職理由') || 
                        currentLine.includes('添付資料') ||
                        currentLine.includes('キャリアサポート部')) {
                        console.log(`📝 推薦理由セクション終了: "${currentLine}"`);
                        break;
                    }
                    
                    // 空行や短すぎる行はスキップしつつ、有効な内容を追加
                    if (currentLine.length > 5) {
                        commentLines.push(currentLine);
                    }
                    
                    j++;
                }
                
                if (commentLines.length > 0) {
                    // 箇条書きや段落を統合
                    commentCandidate = commentLines.join('\n');
                    confidence = 90;
                    console.log(`✅ 推薦時コメント抽出完了: ${commentLines.length}行`);
                    console.log(`📝 内容プレビュー: "${commentCandidate.substring(0, 100)}..."`);
                    break;
                }
            }
        }
        
        if (!commentCandidate) {
            console.log('⚠️ 推薦時コメントが見つかりませんでした');
        }
        
        return {
            comment: commentCandidate,
            confidence: confidence
        };
    }

    /**
     * テキストから職務要約（経歴）を抽出
     */
    extractCareerSummaryFromText(text) {
        console.log('\n🔍 テキストから職務要約（経歴）を抽出します...');
        
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        let summaryCandidate = null;
        let confidence = 0;
        
        // 「職務要約」セクションを探す
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // 職務要約のラベルを検出（■職務要約、職務要約、職歴要約など）
            if (line.includes('職務要約') || line.includes('■職務要約') || 
                line.includes('職歴要約') || line.includes('■職歴要約') || 
                line.includes('経歴要約')) {
                console.log(`📝 職務要約ラベル発見: "${line}"`);
                
                // 職務要約の後のコンテンツを収集
                const summaryLines = [];
                let j = i + 1;
                
                // 次のセクション（活かせる経験・知識・技術など）が出現するまで収集
                while (j < lines.length) {
                    const currentLine = lines[j];
                    
                    // 終了条件: 次のセクションヘッダー
                    if (currentLine.includes('活かせる経験') || 
                        currentLine.includes('■活かせる') ||
                        currentLine.includes('スキル') ||
                        currentLine.includes('資格') ||
                        currentLine.includes('学歴') ||
                        currentLine.includes('知識') ||
                        currentLine.includes('技術') ||
                        (currentLine.includes('■') && currentLine !== line)) {
                        console.log(`📝 職務要約セクション終了: "${currentLine}"`);
                        break;
                    }
                    
                    // 有効な内容行を追加（短すぎる行は除外）
                    if (currentLine.length > 10) {
                        summaryLines.push(currentLine);
                    }
                    
                    j++;
                }
                
                if (summaryLines.length > 0) {
                    // 段落を統合
                    summaryCandidate = summaryLines.join('\n');
                    confidence = 85;
                    console.log(`✅ 職務要約抽出完了: ${summaryLines.length}行`);
                    console.log(`📝 内容プレビュー: "${summaryCandidate.substring(0, 100)}..."`);
                    break;
                }
            }
        }
        
        if (!summaryCandidate) {
            console.log('⚠️ 職務要約が見つかりませんでした');
        }
        
        return {
            summary: summaryCandidate,
            confidence: confidence
        };
    }

    /**
     * 信頼度を計算
     */
    calculateConfidence(name, furigana) {
        let confidence = 0;
        
        if (name) {
            confidence += 60;
            
            // 適切な長さ
            if (name.length >= 3 && name.length <= 8) {
                confidence += 20;
            }
            
            // スペースで区切られている
            if (name.includes(' ')) {
                confidence += 10;
            }
        }
        
        if (furigana) {
            confidence += 10;
        }
        
        return Math.min(confidence, 100);
    }
}

module.exports = { SimplePDFExtractor }; 