const fs = require('fs');
const pdfParse = require('pdf-parse');
const PDFParser = require('pdf2json');

/**
 * 構造化されたPDF（履歴書）から氏名を抽出する新しいアプローチ
 */
class StructuredPDFExtractor {
    constructor() {
        this.debug = true;
    }

    /**
     * PDFファイルから構造化されたデータを抽出
     */
    async extractStructuredData(pdfPath) {
        try {
            console.log('📄 構造化PDFの解析を開始します...');
            
            // pdf2jsonを使用してPDFの構造情報を取得
            const structuredData = await this.extractWithStructure(pdfPath);
            
            // 履歴書の氏名欄を特定して抽出
            const nameData = this.extractNameFromStructure(structuredData);
            
            return {
                success: true,
                extractedName: nameData.name,
                furigana: nameData.furigana,
                confidence: nameData.confidence,
                method: 'structured-extraction',
                debugInfo: this.debug ? structuredData.debugInfo : null
            };
            
        } catch (error) {
            console.error('❌ 構造化PDF解析エラー:', error.message);
            return {
                success: false,
                error: error.message,
                extractedName: null,
                furigana: null,
                confidence: 0
            };
        }
    }

    /**
     * pdf2jsonを使用してPDFの構造情報を抽出
     */
    async extractWithStructure(pdfPath) {
        return new Promise((resolve, reject) => {
            const pdfParser = new PDFParser();
            
            pdfParser.on("pdfParser_dataError", errData => {
                reject(new Error(`PDF解析エラー: ${errData.parserError}`));
            });
            
            pdfParser.on("pdfParser_dataReady", pdfData => {
                try {
                    console.log(`📊 PDF情報: ${pdfData.Pages.length}ページ`);
                    
                    // 最初のページ（履歴書のヘッダー部分）を解析
                    const firstPage = pdfData.Pages[0];
                    const textElements = this.extractTextElements(firstPage);
                    
                    resolve({
                        pageCount: pdfData.Pages.length,
                        firstPageElements: textElements,
                        debugInfo: {
                            totalElements: textElements.length,
                            elementTypes: this.analyzeElementTypes(textElements)
                        }
                    });
                    
                } catch (error) {
                    reject(error);
                }
            });
            
            pdfParser.loadPDF(pdfPath);
        });
    }

    /**
     * ページからテキスト要素を抽出し、位置情報と共に整理
     */
    extractTextElements(page) {
        const elements = [];
        
        page.Texts.forEach((textObj, index) => {
            textObj.R.forEach((run, runIndex) => {
                try {
                    let text = decodeURIComponent(run.T);
                    
                    // 文字化け修正
                    text = this.fixEncoding(text);
                    
                    elements.push({
                        id: `${index}-${runIndex}`,
                        text: text,
                        x: textObj.x,
                        y: textObj.y,
                        fontSize: run.TS ? run.TS[1] : 12,
                        fontFamily: run.TS ? run.TS[0] : 0
                    });
                } catch (error) {
                    console.warn(`⚠️ テキスト要素の処理でエラー: ${error.message}`);
                }
            });
        });
        
        // Y座標でソート（上から下へ）
        elements.sort((a, b) => b.y - a.y);
        
        return elements;
    }

    /**
     * 文字エンコーディングの問題を修正
     */
    fixEncoding(text) {
        // 基本的な文字化け修正
        try {
            // URIデコードの再試行
            if (text.includes('%')) {
                text = decodeURIComponent(text);
            }
            
            // 全角文字の正規化
            text = text.normalize('NFKC');
            
            return text;
        } catch (error) {
            return text; // 修正できない場合は元のテキストを返す
        }
    }

    /**
     * 構造化されたデータから氏名を抽出
     */
    extractNameFromStructure(structuredData) {
        const elements = structuredData.firstPageElements;
        
        console.log('🔍 氏名の抽出を開始します...');
        
        // デバッグ: 全要素を表示
        if (this.debug) {
            console.log('\n📋 検出された全テキスト要素:');
            elements.forEach((element, index) => {
                console.log(`${index + 1}. "${element.text}" (x:${element.x.toFixed(2)}, y:${element.y.toFixed(2)})`);
            });
        }
        
        // 氏名抽出のロジック
        const nameResult = this.findNameInElements(elements);
        
        return nameResult;
    }

    /**
     * 要素から氏名を特定する
     */
    findNameInElements(elements) {
        // 1. 「氏名」ラベルを探す
        const nameLabels = elements.filter(el => 
            el.text.includes('氏名') || el.text.includes('名前')
        );
        
        console.log(`🏷️ 氏名ラベル候補: ${nameLabels.length}個`);
        nameLabels.forEach(label => {
            console.log(`   - "${label.text}" (x:${label.x.toFixed(2)}, y:${label.y.toFixed(2)})`);
        });
        
        // 2. フリガナを探す
        const furiganaElements = elements.filter(el => 
            el.text.includes('フリガナ') || el.text.includes('ふりがな') ||
            /^[ア-ンあ-ん\s]+$/.test(el.text.trim())
        );
        
        console.log(`📝 フリガナ候補: ${furiganaElements.length}個`);
        furiganaElements.forEach(furi => {
            console.log(`   - "${furi.text}" (x:${furi.x.toFixed(2)}, y:${furi.y.toFixed(2)})`);
        });
        
        // 3. 日本語の氏名候補を探す
        const nameCandidate = this.findJapaneseName(elements, nameLabels);
        
        // 4. フリガナを対応付け
        const furiganaCandidate = this.findMatchingFurigana(nameCandidate, furiganaElements);
        
        return {
            name: nameCandidate ? nameCandidate.text : null,
            furigana: furiganaCandidate ? furiganaCandidate.text : null,
            confidence: nameCandidate ? this.calculateConfidence(nameCandidate, furiganaCandidate) : 0,
            position: nameCandidate ? { x: nameCandidate.x, y: nameCandidate.y } : null
        };
    }

    /**
     * 日本語の氏名を探す（文字が分離されている場合も対応）
     */
    findJapaneseName(elements, nameLabels) {
        // まず「氏名」ラベルを探す
        const nameLabel = elements.find(el => 
            el.text === '氏' || el.text === '名' || 
            (el.text.includes('氏') && el.text.includes('名'))
        );
        
        if (nameLabel) {
            console.log(`🏷️ 氏名ラベルを発見: "${nameLabel.text}" (x:${nameLabel.x.toFixed(2)}, y:${nameLabel.y.toFixed(2)})`);
            
            // 氏名ラベルの近くにある日本語文字を収集
            const nameChars = this.collectNearbyJapaneseChars(elements, nameLabel);
            
            if (nameChars.length >= 2) {
                const combinedName = this.combineNameChars(nameChars);
                console.log(`✅ 分離された文字から氏名を構築: "${combinedName}"`);
                
                return {
                    text: combinedName,
                    x: nameChars[0].x,
                    y: nameChars[0].y
                };
            }
        }
        
        // 氏名ラベルが見つからない場合、「田中健太」のような文字の並びを探す
        console.log('🔍 分離された日本語文字から氏名を推定します...');
        const nameSequence = this.findNameSequence(elements);
        
        if (nameSequence) {
            console.log(`✅ 文字シーケンスから氏名を発見: "${nameSequence.text}"`);
            return nameSequence;
        }
        
        return null;
    }

    /**
     * ラベルの近くにある日本語文字を収集
     */
    collectNearbyJapaneseChars(elements, labelElement) {
        const chars = elements.filter(el => {
            // 日本語文字のみ
            if (!/^[一-龯]$/.test(el.text.trim())) return false;
            
            // ラベルの近く（右側または下側）
            const isRight = el.x > labelElement.x && el.x < labelElement.x + 10;
            const isBelow = el.y < labelElement.y && el.y > labelElement.y - 3;
            const sameRow = Math.abs(el.y - labelElement.y) < 1;
            
            return (isRight && sameRow) || isBelow;
        });
        
        // X座標でソート（左から右へ）
        chars.sort((a, b) => a.x - b.x);
        
        console.log(`📝 ラベル近くの日本語文字: ${chars.map(c => c.text).join('')}`);
        return chars;
    }

    /**
     * 分離された氏名文字を結合
     */
    combineNameChars(chars) {
        const text = chars.map(c => c.text).join('');
        
        // 4文字の場合は2文字ずつに分割（田中健太 → 田中 健太）
        if (text.length === 4) {
            return text.substring(0, 2) + ' ' + text.substring(2);
        }
        
        // 3文字の場合は1文字目と残りに分割
        if (text.length === 3) {
            return text.substring(0, 1) + ' ' + text.substring(1);
        }
        
        return text;
    }

    /**
     * 氏名らしい文字のシーケンスを探す（田中健太など）
     */
    findNameSequence(elements) {
        // Y座標が同じで、連続するX座標の日本語文字を探す
        const japaneseChars = elements.filter(el => /^[一-龯]$/.test(el.text.trim()));
        
        // Y座標でグループ化
        const rowGroups = {};
        japaneseChars.forEach(char => {
            const rowKey = Math.round(char.y * 10) / 10; // 0.1の精度でグループ化
            if (!rowGroups[rowKey]) {
                rowGroups[rowKey] = [];
            }
            rowGroups[rowKey].push(char);
        });
        
        // 各行で連続する文字を探す
        for (const [y, chars] of Object.entries(rowGroups)) {
            if (chars.length < 2) continue;
            
            // X座標でソート
            chars.sort((a, b) => a.x - b.x);
            
            // 連続する文字を見つける
            const sequences = [];
            let currentSequence = [chars[0]];
            
            for (let i = 1; i < chars.length; i++) {
                const prevChar = chars[i - 1];
                const currentChar = chars[i];
                
                // X座標の差が小さい場合は連続とみなす
                if (Math.abs(currentChar.x - prevChar.x) < 1.0) {
                    currentSequence.push(currentChar);
                } else {
                    if (currentSequence.length >= 2) {
                        sequences.push(currentSequence);
                    }
                    currentSequence = [currentChar];
                }
            }
            
            // 最後のシーケンスも追加
            if (currentSequence.length >= 2) {
                sequences.push(currentSequence);
            }
            
            // 最も長いシーケンスを選択
            if (sequences.length > 0) {
                const bestSequence = sequences.reduce((prev, curr) => 
                    curr.length > prev.length ? curr : prev
                );
                
                if (bestSequence.length >= 2) {
                    const text = this.combineNameChars(bestSequence);
                    console.log(`📝 文字シーケンス発見 (y:${y}): ${bestSequence.map(c => c.text).join('')} → "${text}"`);
                    
                    // 氏名らしいかチェック
                    if (this.isValidName(text)) {
                        return {
                            text: text,
                            x: bestSequence[0].x,
                            y: bestSequence[0].y
                        };
                    }
                }
            }
        }
        
        return null;
    }

    /**
     * 有効な氏名かチェック
     */
    isValidName(text) {
        // 基本的な妥当性チェック
        if (!text || text.length < 2 || text.length > 8) return false;
        
        // 日本語文字のみ
        if (!/^[一-龯\s]+$/.test(text)) return false;
        
        // 一般的でない単語を除外
        const invalidWords = ['推薦', '理由', '登録', '職種', '会社', '銀行', '営業'];
        if (invalidWords.some(word => text.includes(word))) return false;
        
        return true;
    }

    /**
     * 氏名に対応するフリガナを探す（分離された文字も結合）
     */
    findMatchingFurigana(nameElement, furiganaElements) {
        if (!nameElement) return null;
        
        // 「フリガナ」ラベルを探す
        const furiganaLabel = furiganaElements.find(el => 
            el.text.includes('フリガナ') || el.text === 'フ' || el.text === 'ナ'
        );
        
        if (furiganaLabel) {
            console.log(`📝 フリガナラベルを発見: "${furiganaLabel.text}"`);
            
            // フリガナラベルの近くにあるカタカナ文字を収集
            const furiganaChars = this.collectNearbyKatakanaChars(furiganaElements, furiganaLabel);
            
            if (furiganaChars.length >= 2) {
                const combinedFurigana = this.combineFuriganaChars(furiganaChars);
                console.log(`✅ 分離されたフリガナを構築: "${combinedFurigana}"`);
                
                return {
                    text: combinedFurigana,
                    x: furiganaChars[0].x,
                    y: furiganaChars[0].y
                };
            }
        }
        
        // ラベルが見つからない場合、カタカナの連続を探す
        const katakanaSequence = this.findKatakanaSequence(furiganaElements);
        
        if (katakanaSequence) {
            console.log(`✅ カタカナシーケンスからフリガナを発見: "${katakanaSequence.text}"`);
            return katakanaSequence;
        }
        
        return null;
    }

    /**
     * ラベルの近くにあるカタカナ文字を収集
     */
    collectNearbyKatakanaChars(elements, labelElement) {
        const chars = elements.filter(el => {
            // カタカナ文字のみ
            if (!/^[ア-ン]$/.test(el.text.trim())) return false;
            
            // ラベルの近く（右側または下側）
            const isRight = el.x > labelElement.x && el.x < labelElement.x + 15;
            const isBelow = el.y < labelElement.y && el.y > labelElement.y - 3;
            const sameRow = Math.abs(el.y - labelElement.y) < 1;
            
            return (isRight && sameRow) || isBelow;
        });
        
        // X座標でソート（左から右へ）
        chars.sort((a, b) => a.x - b.x);
        
        console.log(`📝 ラベル近くのカタカナ文字: ${chars.map(c => c.text).join('')}`);
        return chars;
    }

    /**
     * 分離されたフリガナ文字を結合
     */
    combineFuriganaChars(chars) {
        const katakana = chars.map(c => c.text).join('');
        
        // カタカナをひらがなに変換
        const hiragana = katakana.replace(/[ア-ン]/g, (char) => 
            String.fromCharCode(char.charCodeAt(0) - 0x60)
        );
        
        // 4文字の場合は2文字ずつに分割（タナカケンタ → たなか けんた）
        if (hiragana.length === 4) {
            return hiragana.substring(0, 2) + ' ' + hiragana.substring(2);
        }
        
        // 3文字の場合は1文字目と残りに分割
        if (hiragana.length === 3) {
            return hiragana.substring(0, 1) + ' ' + hiragana.substring(1);
        }
        
        return hiragana;
    }

    /**
     * カタカナのシーケンスを探す
     */
    findKatakanaSequence(elements) {
        // Y座標が同じで、連続するX座標のカタカナ文字を探す
        const katakanaChars = elements.filter(el => /^[ア-ン]$/.test(el.text.trim()));
        
        // Y座標でグループ化
        const rowGroups = {};
        katakanaChars.forEach(char => {
            const rowKey = Math.round(char.y * 10) / 10;
            if (!rowGroups[rowKey]) {
                rowGroups[rowKey] = [];
            }
            rowGroups[rowKey].push(char);
        });
        
        // 各行で連続する文字を探す
        for (const [y, chars] of Object.entries(rowGroups)) {
            if (chars.length < 4) continue; // フリガナは最低4文字以上
            
            // X座標でソート
            chars.sort((a, b) => a.x - b.x);
            
            // 連続する文字を見つける
            const sequences = [];
            let currentSequence = [chars[0]];
            
            for (let i = 1; i < chars.length; i++) {
                const prevChar = chars[i - 1];
                const currentChar = chars[i];
                
                // X座標の差が小さい場合は連続とみなす
                if (Math.abs(currentChar.x - prevChar.x) < 1.0) {
                    currentSequence.push(currentChar);
                } else {
                    if (currentSequence.length >= 4) {
                        sequences.push(currentSequence);
                    }
                    currentSequence = [currentChar];
                }
            }
            
            // 最後のシーケンスも追加
            if (currentSequence.length >= 4) {
                sequences.push(currentSequence);
            }
            
            // 最も長いシーケンスを選択
            if (sequences.length > 0) {
                const bestSequence = sequences.reduce((prev, curr) => 
                    curr.length > prev.length ? curr : prev
                );
                
                if (bestSequence.length >= 4) {
                    const text = this.combineFuriganaChars(bestSequence);
                    console.log(`📝 カタカナシーケンス発見 (y:${y}): ${bestSequence.map(c => c.text).join('')} → "${text}"`);
                    
                    return {
                        text: text,
                        x: bestSequence[0].x,
                        y: bestSequence[0].y
                    };
                }
            }
        }
        
        return null;
    }

    /**
     * 抽出の信頼度を計算
     */
    calculateConfidence(nameElement, furiganaElement) {
        let confidence = 50; // ベース信頼度
        
        // 氏名の妥当性チェック
        if (nameElement) {
            const text = nameElement.text.trim();
            
            // 適切な長さ
            if (text.length >= 2 && text.length <= 8) {
                confidence += 20;
            }
            
            // 日本語文字のみ
            if (/^[一-龯\s　]+$/.test(text)) {
                confidence += 20;
            }
            
            // スペース区切りの姓名
            if (text.includes(' ') || text.includes('　')) {
                confidence += 10;
            }
        }
        
        // フリガナがある場合
        if (furiganaElement) {
            confidence += 15;
        }
        
        return Math.min(confidence, 100);
    }

    /**
     * 要素タイプの分析（デバッグ用）
     */
    analyzeElementTypes(elements) {
        const types = {
            japanese: 0,
            hiragana: 0,
            katakana: 0,
            numbers: 0,
            symbols: 0,
            mixed: 0
        };
        
        elements.forEach(el => {
            const text = el.text.trim();
            if (/^[一-龯]+$/.test(text)) types.japanese++;
            else if (/^[あ-ん]+$/.test(text)) types.hiragana++;
            else if (/^[ア-ン]+$/.test(text)) types.katakana++;
            else if (/^[0-9]+$/.test(text)) types.numbers++;
            else if (/^[^\w\s]+$/.test(text)) types.symbols++;
            else types.mixed++;
        });
        
        return types;
    }
}

module.exports = { StructuredPDFExtractor }; 