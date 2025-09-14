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
            
            // 氏名を抽出
            const nameResult = this.extractNameFromText(data.text);
            
            return {
                success: true,
                fullText: data.text,
                extractedName: nameResult.name,
                furigana: nameResult.furigana,
                confidence: nameResult.confidence,
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