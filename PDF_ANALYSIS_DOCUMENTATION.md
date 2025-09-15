# PDF処理・RAコメント処理システム ドキュメント

## 概要
このシステムは、PDFファイルから履歴書情報を抽出し、RAコメントから求人名と追加必須項目を解析する自動化ツールです。

## 1. RAコメント処理

### 1.1 基本構造
```
W送付[求人名]※[追加情報]
```

### 1.2 求人名抽出ロジック
```javascript
// パターンマッチング
const wSendPattern = /W送付\s*(.+)/;
const wSendMatch = raMemoRaw.match(wSendPattern);

if (wSendMatch && wSendMatch[1]) {
    let afterWSend = wSendMatch[1].trim();
    let jobName;
    
    // ※がある場合は、そこで区切る
    if (afterWSend.includes('※')) {
        jobName = afterWSend.split('※')[0].trim();
    } else {
        // ※がない場合は、W送付の後全体を求人名とする
        jobName = afterWSend;
    }
}
```

### 1.3 追加必須項目の抽出パターン

#### 年収関連
```javascript
const salaryRules = {
    currentSalary: {
        patterns: [/現年収[：:\s]*(\d+|０)万円?/g, /現在年収[：:\s]*(\d+|０)万円?/g],
        fieldNames: ['現在の年収', '年収（現在）', '現年収'],
        specialCases: { '０': '退職ケース', '0': '退職ケース' }
    },
    desiredSalary: {
        patterns: [/希望年収[：:\s]*(\d+)万円?/g],
        fieldNames: ['希望年収', '年収（希望）'],
        contextCheck: true
    },
    minimumSalary: {
        patterns: [/最低[希望]*年収[：:\s]*(\d+)万円?/g],
        fieldNames: ['最低希望年収', '年収（最低）']
    }
};
```

#### その他の条件
```javascript
const otherRules = {
    salaryNote: {
        patterns: [/希望年収.*?[【（\[].*?(仮|面談|確認).*?[】）\]]/g],
        fieldNames: ['その他希望条件', 'その他の希望条件', '備考']
    },
    currentCompany: {
        patterns: [/現職[はわ：:\s]*(.+?)[株式会社|会社|Corporation|Corp]/g],
        fieldNames: ['現所属', '現在の所属', '勤務先']
    }
};
```

### 1.4 テストケース例

#### 全要素複合パターン
```
W送付プロジェクトマネージャー※現職はソニー株式会社、現年収:750万円、希望年収:850万円【希望年収は仮のため面談で確認】、最低希望年収:800万円
```
**抽出される必須項目**:
- 現在の年収
- 希望年収
- 最低希望年収
- その他希望条件（補足文言のため）
- 現所属

#### 退職ケース
```
W送付プロジェクトマネージャー※現年収:０万円（退職のため）、希望年収:700万円
```
**抽出される必須項目**:
- 現在の年収（退職ケースとして検出）
- 希望年収

## 2. PDF処理

### 2.1 使用ライブラリ
- `pdf-parse`: PDFからテキスト抽出
- `SimplePDFExtractor`: 抽出ロジックの実装

### 2.2 抽出項目とパターン

#### 基本情報
```javascript
// 氏名抽出
const namePatterns = [
    /([一-龯]{1,4})[\s　]+([一-龯]{1,4})/,  // 田中　健太
    /^([一-龯]{2})([一-龯]{2})$/,          // 田中健太（4文字）
    /^([一-龯]{1})([一-龯]{2})$/           // 田中健太（3文字）
];

// フリガナ抽出
const furiganaPatterns = [
    /[ア-ン]+(?:\s+[ア-ン]+)*/,  // カタカナ
    /[あ-ん]+(?:\s+[あ-ん]+)*/   // ひらがな
];

// 年齢抽出
const agePatterns = [
    /満(\d{1,2})歳/,           // 満25歳
    /\(満(\d{1,2})歳\)/,      // (満25歳)
    /（満(\d{1,2})歳）/,      // （満25歳）
    /(\d{1,2})歳\s*男/,       // 25歳 男
    /(\d{1,2})歳\s*女/        // 25歳 女
];

// 電話番号抽出
const phonePatterns = [
    /電話[：:\s]*(\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4})/,
    /TEL[：:\s]*(\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4})/,
    /(0\d{1,3}[-\s]?\d{2,4}[-\s]?\d{4})/,
    /(0\d{9,10})/
];

// メールアドレス抽出
const emailPatterns = [
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/,
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/
];
```

#### 詳細情報
```javascript
// 推薦時コメント抽出
// 「推薦理由」セクションから「面談所感」までを抽出

// 職務要約抽出
// 「職務要約」セクションから次のセクションまでを抽出

// 学歴・職歴抽出
const datePatterns = [
    /(\d{4})\s*[年\/\-]\s*(\d{1,2})/,  // 2015年3月
    /^(\d{4})(\d{1,2})(?=\D|$)/,       // 20153
    /(\d{4})\s*年?\s*(\d{1,2})\s*月?/  // 2015年3月
];
```

### 2.3 現所属・最終学歴の抽出

#### 現所属会社名抽出
```javascript
const companyPatterns = [
    // 株式会社等+入社・転職
    /([^\s（\n]*(?:株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人))\s*(?:入社|転職)/,
    // その他法人格+入社・転職
    /([^\s（\n]*(?:会社|法人|グループ|ホールディングス|コーポレーション))\s*(?:入社|転職)/,
    // 入社の前の単語を会社名として抽出
    /([^\s（\n]+)\s*(?:入社|転職)/
];
```

#### 最終学歴抽出
```javascript
const educationPatterns = [
    /^([^\s]+(?:大学|短期大学|大学院|高等学校|高校|専門学校|専修学校|学院)(?:\s*[^\s]*学部)?(?:\s*[^\s]*学科)?(?:\s*[^\s]*専攻)?)\s*卒業/,
    /([^\s]+(?:大学|短期大学|大学院|高等学校|高校|専門学校|専修学校|学院)(?:\s*[^\s]*学部)?(?:\s*[^\s]*学科)?(?:\s*[^\s]*専攻)?)\s*卒業/
];
```

### 2.4 ノイズ除去とセクション判定

#### ノイズ除去パターン
```javascript
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
```

#### セクション判定
```javascript
// 学歴セクション開始
isEducationSectionStart(line) {
    return (line.includes('学歴') && !line.includes('職歴')) ||
           line === '学歴' ||
           (line.includes('学歴・職歴') && line.indexOf('学歴') < line.indexOf('職歴'));
}

// 職歴セクション開始
isCareerSectionStart(line) {
    return (line.includes('職歴') && !line.includes('学歴')) ||
           line === '職歴';
}
```

## 3. 信頼度計算

### 3.1 氏名の信頼度計算
```javascript
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
```

### 3.2 安全性チェック
```javascript
const SAFETY_CONFIG = {
    MINIMUM_CONFIDENCE_THRESHOLD: 90,
    ENABLE_STRICT_MODE: true,
    LOG_ALL_EXTRACTIONS: true,
    MAX_RETRY_ATTEMPTS: 3,
    PAGE_TIMEOUT: 30000,
    ELEMENT_WAIT_TIMEOUT: 5000,
    FILE_SIZE_LIMIT: 10 * 1024 * 1024 // 10MB
};
```

## 4. 統合処理フロー

### 4.1 メイン処理
```javascript
// 1. PDF処理
const simplePDFExtractor = new SimplePDFExtractor();
simplePDFExtractor.debug = true;

let pdfResult;
try {
    pdfResult = await simplePDFExtractor.extractTextFromPDF(pdfFile.path);
} catch (pdfError) {
    sendLog(`PDF抽出器エラー: ${pdfError.message}`, 'error');
    throw new Error(`PDF解析に失敗しました: ${pdfError.message}`);
}

// 2. RAコメント処理
const extractionResult = extractJobNameFromComplexFormat(jsonData);

// 3. 信頼度チェック
if (extractionResult.confidence < SAFETY_CONFIG.MINIMUM_CONFIDENCE_THRESHOLD) {
    sendLog(`信頼度が不足しています (${extractionResult.confidence}% < ${SAFETY_CONFIG.MINIMUM_CONFIDENCE_THRESHOLD}%)`, 'error');
    return res.status(400).json({ 
        error: '抽出の信頼度が不足しています',
        confidence: extractionResult.confidence,
        threshold: SAFETY_CONFIG.MINIMUM_CONFIDENCE_THRESHOLD
    });
}
```

### 4.2 抽出結果の活用
- 氏名、年齢、電話番号、メールアドレスをログ出力
- 現所属、最終学歴を抽出
- 推薦時コメント、職務要約を抽出
- 学歴・職歴の詳細データを構造化
- HERPフォームの入力項目を動的に決定

## 5. テストケース

### 5.1 RAコメントテストケース
- `test_ra_all_elements.json`: 全要素複合パターン
- `test_ra_salary_note.json`: 希望年収補足文言
- `test_ra_retirement_case.json`: 退職ケース
- `test_ra_current_company.json`: 現所属情報
- `test_ra_no_note.json`: 米印なしパターン

### 5.2 PDF処理テストケース
- 各種履歴書フォーマットに対応
- ページ跨ぎデータの処理
- ノイズ除去の検証
- セクション判定の精度確認

## 6. 注意事項

### 6.1 安全性
- 信頼度90%未満は処理停止
- 複数候補がある場合は処理停止
- 不正な形式は処理停止
- 全ての処理過程がログに記録される

### 6.2 制限事項
- PDFファイルサイズ制限: 10MB
- ページタイムアウト: 30秒
- 要素待機タイムアウト: 5秒
- 最大リトライ回数: 3回

## 7. ログ出力例

```
📄 pdf-parseを使用してPDFテキストを抽出します...
📊 PDF情報:
  - ページ数: 2
  - 総文字数: 15432

🔍 テキストから氏名を抽出します...
✅ 同じ行で氏名発見: "田中 健太"
✅ フリガナ発見: "たなか けんた"

🔍 テキストから年齢を抽出します...
✅ 年齢発見: "満28歳" → 28歳

🔍 テキストから電話番号を抽出します...
✅ 電話番号発見: "電話 080-1234-5678" → 080-1234-5678

🔍 テキストからメールアドレスを抽出します...
✅ メールアドレス発見: "tanaka@example.com" → tanaka@example.com

🏢 現所属会社名を抽出します...
✅ 現所属会社抽出成功: "株式会社ソニー" (パターン1, 2023年04月)

🎓 最終学歴を抽出します...
✅ 最終学歴抽出成功: "東京大学 工学部 情報工学科" (2020年03月)
```

このドキュメントにより、システムの動作原理と実装詳細を理解し、他の開発者との共有が可能になります。
