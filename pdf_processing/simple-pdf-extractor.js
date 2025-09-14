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
            const educationCareerDetails = this.extractEducationAndCareerDetails(data.text);
            
            // 現所属と最終学歴を抽出
            console.log('\n🚀 === 現所属・最終学歴抽出開始 ===');
            console.log(`📊 学歴・職歴データ状況: ${educationCareerDetails ? 'あり' : 'なし'}`);
            if (educationCareerDetails) {
                console.log(`  📚 学歴エントリ数: ${educationCareerDetails.educationEntries?.length || 0}`);
                console.log(`  💼 職歴エントリ数: ${educationCareerDetails.careerEntries?.length || 0}`);
            }
            
            const currentCompany = this.extractCurrentCompany(educationCareerDetails);
            const finalEducation = this.extractFinalEducation(educationCareerDetails);
            
            console.log('\n🎯 === 抽出結果サマリー ===');
            console.log(`🏢 現所属: ${currentCompany?.company || '抽出失敗'}`);
            console.log(`🎓 最終学歴: ${finalEducation?.education || '抽出失敗'}`);
            console.log('🚀 === 現所属・最終学歴抽出完了 ===\n');
            
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
                educationDetails: educationCareerDetails,
                currentCompany: currentCompany,
                finalEducation: finalEducation,
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
                    console.log(`📝 処理中の行 ${j}: "${currentLine}"`);
                    
                    // 終了条件: 面談所感、転職理由、添付資料などが出現（ただし、現在行も含める）
                    const isEndCondition = currentLine.includes('面談所感') || 
                                          currentLine.includes('転職理由') || 
                                          currentLine.includes('添付資料') ||
                                          currentLine.includes('キャリアサポート部');
                    
                    if (isEndCondition) {
                        console.log(`📝 推薦理由セクション終了: "${currentLine}"`);
                        break;
                    }
                    
                    // すべての行を追加（空行も含める - 改行情報を保持）
                    commentLines.push(currentLine);
                    console.log(`📝 行を追加: "${currentLine}" (合計: ${commentLines.length}行)`);
                    
                    j++;
                }
                
                if (commentLines.length > 0) {
                    // 末尾の空行を除去
                    while (commentLines.length > 0 && commentLines[commentLines.length - 1].trim() === '') {
                        commentLines.pop();
                    }
                    
                    // 箇条書きや段落を統合
                    commentCandidate = commentLines.join('\n');
                    confidence = 90;
                    console.log(`✅ 推薦時コメント抽出完了: ${commentLines.length}行`);
                    console.log(`📝 内容プレビュー: "${commentCandidate.substring(0, 100)}..."`);
                    console.log(`📝 最後の3行:`, commentLines.slice(-3));
                    console.log(`📝 完全な内容:\n${commentCandidate}`);
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

    /**
     * テキストから学歴・職歴の詳細情報を抽出（表形式データ・ページ跨ぎ対応）
     */
    extractEducationAndCareerDetails(text) {
        console.log('\n🔍 学歴・職歴の詳細情報を抽出します（ページ跨ぎ対応）...');
        
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const result = {
            educationEntries: [],
            careerEntries: [],
            rawEducationSection: [],
            rawCareerSection: []
        };
        
        let currentSection = null;
        let inEducationSection = false;
        let inCareerSection = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // ノイズ除去: 求人情報、ヘッダー、ファイルパス等を除外
            if (this.isNoiseContent(line)) {
                continue;
            }
            
            // 学歴セクションの開始を検出（ページ跨ぎ対応）
            if (this.isEducationSectionStart(line)) {
                console.log(`📚 学歴セクション開始: "${line}"`);
                inEducationSection = true;
                inCareerSection = false;
                currentSection = 'education';
                continue;
            }
            
            // 職歴セクションの開始を検出（ページ跨ぎ対応）
            if (this.isCareerSectionStart(line)) {
                console.log(`💼 職歴セクション開始: "${line}"`);
                inEducationSection = false;
                inCareerSection = true;
                currentSection = 'career';
                continue;
            }
            
            // 強化された年月日パターン検出
            const dateInfo = this.extractDateFromLine(line);
            
            if (dateInfo && (inEducationSection || inCareerSection)) {
                const entry = {
                    year: dateInfo.year,
                    month: dateInfo.month,
                    content: dateInfo.content,
                    rawLine: line
                };
                
                if (inEducationSection) {
                    result.educationEntries.push(entry);
                    result.rawEducationSection.push(line);
                    console.log(`📚 学歴エントリ: ${dateInfo.year}年${dateInfo.month}月 - ${dateInfo.content}`);
                } else if (inCareerSection) {
                    result.careerEntries.push(entry);
                    result.rawCareerSection.push(line);
                    console.log(`💼 職歴エントリ: ${dateInfo.year}年${dateInfo.month}月 - ${dateInfo.content}`);
                }
            } else if (inEducationSection || inCareerSection) {
                // 年月がない行でも、学歴・職歴セクション内の有用な情報は記録
                if (this.isValidContent(line)) {
                    if (inEducationSection) {
                        result.rawEducationSection.push(line);
                        console.log(`📚 学歴関連情報: ${line}`);
                    } else if (inCareerSection) {
                        result.rawCareerSection.push(line);
                        console.log(`💼 職歴関連情報: ${line}`);
                    }
                }
            }
            
            // セクション終了の検出（改善版）
            if (this.isSectionEnd(line)) {
                if (inEducationSection || inCareerSection) {
                    console.log(`🔚 セクション終了検出: "${line}"`);
                }
                inEducationSection = false;
                inCareerSection = false;
                currentSection = null;
            }
        }
        
        // 結果の後処理とクリーンアップ
        this.cleanupExtractedData(result);
        
        // 結果のサマリーを出力
        console.log(`\n📊 学歴・職歴抽出結果:`);
        console.log(`  📚 学歴エントリ数: ${result.educationEntries.length}`);
        console.log(`  💼 職歴エントリ数: ${result.careerEntries.length}`);
        console.log(`  📚 学歴関連行数: ${result.rawEducationSection.length}`);
        console.log(`  💼 職歴関連行数: ${result.rawCareerSection.length}`);
        
        return result;
    }

    /**
     * ノイズコンテンツの判定
     */
    isNoiseContent(line) {
        const noisePatterns = [
            /PROFESSIONAL CAREER/,
            /求人情報/,
            /K\d+-\d+-\d+/,
            /file:\/\/\//,
            /\.html/,
            /統合文書/,
            /^\d+\/\d+\/\d+ \d+:\d+$/,
            /F\d{6}$/,
            /部⻑：|課⻑：/,
            /勤務地①|勤務地②/,
            /最寄駅|住所|備考/,
            /雇用形態|試用期間|給与想定/,
            /月給制|賞与|就業時間|残業手当/,
            /休日・休暇|社会保険|その他手当/
        ];
        
        return noisePatterns.some(pattern => pattern.test(line));
    }

    /**
     * 学歴セクション開始の判定
     */
    isEducationSectionStart(line) {
        return (line.includes('学歴') && !line.includes('職歴')) ||
               line === '学歴' ||
               (line.includes('学歴・職歴') && line.indexOf('学歴') < line.indexOf('職歴'));
    }

    /**
     * 職歴セクション開始の判定
     */
    isCareerSectionStart(line) {
        return (line.includes('職歴') && !line.includes('学歴')) ||
               line === '職歴';
    }

    /**
     * 強化された日付抽出
     */
    extractDateFromLine(line) {
        console.log(`🔍 日付解析中: "${line}"`);
        
        // パターン1: 2015年3月, 2015/3, 2015-3
        const pattern1 = /(\d{4})\s*[年\/\-]\s*(\d{1,2})/;
        const match1 = line.match(pattern1);
        if (match1) {
            console.log(`✅ パターン1マッチ: ${match1[1]}年${match1[2]}月`);
            return {
                year: match1[1],
                month: match1[2],
                content: line.replace(pattern1, '').trim()
            };
        }

        // パターン2: 20153, 20194 (年月が連続) - より厳密な条件
        const pattern2 = /^(\d{4})(\d{1,2})(?=\D|$)/;
        const match2 = line.match(pattern2);
        if (match2) {
            const month = parseInt(match2[2]);
            console.log(`🔍 パターン2候補: ${match2[1]}年${match2[2]}月 (月チェック: ${month})`);
            if (month >= 1 && month <= 12) {
                console.log(`✅ パターン2マッチ: ${match2[1]}年${match2[2]}月`);
                return {
                    year: match2[1],
                    month: match2[2].padStart(2, '0'), // 01, 02形式に統一
                    content: line.replace(pattern2, '').trim()
                };
            }
        }

        // パターン3: より柔軟な年月検出
        const pattern3 = /(\d{4})\s*年?\s*(\d{1,2})\s*月?/;
        const match3 = line.match(pattern3);
        if (match3) {
            const month = parseInt(match3[2]);
            if (month >= 1 && month <= 12) {
                console.log(`✅ パターン3マッチ: ${match3[1]}年${match3[2]}月`);
                return {
                    year: match3[1],
                    month: match3[2].padStart(2, '0'),
                    content: line.replace(pattern3, '').trim()
                };
            }
        }

        console.log(`❌ 日付パターンなし: "${line}"`);
        return null;
    }

    /**
     * 有効なコンテンツの判定
     */
    isValidContent(line) {
        return line.length > 5 && 
               !this.isNoiseContent(line) &&
               !line.match(/^[\s\-_=]+$/) &&
               !line.match(/^\d+$/);
    }

    /**
     * セクション終了の判定
     */
    isSectionEnd(line) {
        return line.includes('資格') || 
               line.includes('スキル') || 
               line.includes('志望動機') || 
               line.includes('自己PR') ||
               line.includes('■活かせる') ||
               line.includes('以上') ||
               (line.includes('■') && !line.includes('学歴') && !line.includes('職歴'));
    }

    /**
     * 抽出データのクリーンアップ
     */
    cleanupExtractedData(result) {
        // 重複除去
        result.rawEducationSection = [...new Set(result.rawEducationSection)];
        result.rawCareerSection = [...new Set(result.rawCareerSection)];
        
        // 空のエントリを除去
        result.educationEntries = result.educationEntries.filter(entry => 
            entry.content && entry.content.length > 0
        );
        result.careerEntries = result.careerEntries.filter(entry => 
            entry.content && entry.content.length > 0
        );
    }

    /**
     * 最新の職歴から現所属会社名を抽出
     */
    extractCurrentCompany(educationCareerDetails) {
        console.log('\n🏢 現所属会社名を抽出します...');
        
        if (!educationCareerDetails || !educationCareerDetails.careerEntries || educationCareerDetails.careerEntries.length === 0) {
            console.log('❌ 職歴データが見つかりません');
            return { company: null, confidence: 0 };
        }

        // 最新の職歴エントリを取得（年月順でソート）
        const sortedCareerEntries = educationCareerDetails.careerEntries
            .filter(entry => entry.year && entry.month && entry.content)
            .sort((a, b) => {
                const yearDiff = parseInt(b.year) - parseInt(a.year);
                if (yearDiff !== 0) return yearDiff;
                return parseInt(b.month) - parseInt(a.month);
            });

        console.log(`📊 職歴エントリ数: ${sortedCareerEntries.length}`);
        
        for (let i = 0; i < Math.min(3, sortedCareerEntries.length); i++) {
            const entry = sortedCareerEntries[i];
            console.log(`  ${i + 1}. ${entry.year}年${entry.month.padStart(2, '0')}月: ${entry.content.substring(0, 50)}...`);
            
            // 会社名抽出パターン（より柔軟に）
            const companyPatterns = [
                // パターン1: 株式会社等の法人格付き（入社・転職）
                /([^\s（]+(?:株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人))\s*(?:入社|転職)/,
                // パターン2: その他法人格（入社・転職）
                /([^\s（]+(?:会社|法人|グループ|ホールディングス|コーポレーション))\s*(?:入社|転職)/,
                // パターン3: 株式会社等の法人格付き（空白や記号の前まで）
                /([^\s（]+(?:株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人))(?:\s|（|$)/,
                // パターン4: その他法人格（空白や記号の前まで）
                /([^\s（]+(?:会社|法人|グループ|ホールディングス|コーポレーション))(?:\s|（|$)/
            ];

            for (let j = 0; j < companyPatterns.length; j++) {
                const pattern = companyPatterns[j];
                console.log(`  🔍 パターン${j + 1}テスト: ${pattern} → "${entry.content}"`);
                const match = entry.content.match(pattern);
                if (match) {
                    const company = match[1].trim();
                    console.log(`✅ 現所属会社抽出成功: "${company}" (パターン${j + 1}, ${entry.year}年${entry.month}月)`);
                    return {
                        company: company,
                        year: entry.year,
                        month: entry.month,
                        confidence: 90
                    };
                } else {
                    console.log(`  ❌ パターン${j + 1}マッチせず`);
                }
            }
        }

        console.log('⚠️ 会社名の抽出に失敗しました');
        return { company: null, confidence: 0 };
    }

    /**
     * 最新の学歴から最終学歴を抽出
     */
    extractFinalEducation(educationCareerDetails) {
        console.log('\n🎓 最終学歴を抽出します...');
        
        if (!educationCareerDetails || !educationCareerDetails.educationEntries || educationCareerDetails.educationEntries.length === 0) {
            console.log('❌ 学歴データが見つかりません');
            return { education: null, confidence: 0 };
        }

        // 最新の学歴エントリを取得（年月順でソート）
        const sortedEducationEntries = educationCareerDetails.educationEntries
            .filter(entry => entry.year && entry.month && entry.content)
            .sort((a, b) => {
                const yearDiff = parseInt(b.year) - parseInt(a.year);
                if (yearDiff !== 0) return yearDiff;
                return parseInt(b.month) - parseInt(a.month);
            });

        console.log(`📊 学歴エントリ数: ${sortedEducationEntries.length}`);
        
        for (let i = 0; i < Math.min(3, sortedEducationEntries.length); i++) {
            const entry = sortedEducationEntries[i];
            console.log(`  ${i + 1}. ${entry.year}年${entry.month.padStart(2, '0')}月: ${entry.content.substring(0, 50)}...`);
            
            // 学歴抽出パターン（卒業のみを対象）
            if (entry.content.includes('卒業')) {
                // 学校名抽出パターン
                const educationPatterns = [
                    /^([^\s]+(?:大学|短期大学|大学院|高等学校|高校|専門学校|専修学校|学院)(?:\s*[^\s]*学部)?(?:\s*[^\s]*学科)?(?:\s*[^\s]*専攻)?)\s*卒業/,
                    /([^\s]+(?:大学|短期大学|大学院|高等学校|高校|専門学校|専修学校|学院)(?:\s*[^\s]*学部)?(?:\s*[^\s]*学科)?(?:\s*[^\s]*専攻)?)\s*卒業/
                ];

                for (const pattern of educationPatterns) {
                    const match = entry.content.match(pattern);
                    if (match) {
                        const education = match[1].trim();
                        console.log(`✅ 最終学歴抽出成功: "${education}" (${entry.year}年${entry.month}月)`);
                        return {
                            education: education,
                            year: entry.year,
                            month: entry.month,
                            confidence: 90
                        };
                    }
                }
            }
        }

        console.log('⚠️ 学歴の抽出に失敗しました');
        return { education: null, confidence: 0 };
    }
}

module.exports = { SimplePDFExtractor }; 