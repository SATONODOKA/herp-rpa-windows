# プロジェクト構造の再編成完了

## 新しいフォルダ構造
```
herpkyujinshutoku/
├── server.js                    # メインサーバー
├── package.json                 # 設定ファイル
├── package-lock.json
├── public/                      # フロントエンド
│   └── index.html
├── src/                         # ソースコード
│   └── pdf_processing/          # PDF処理モジュール
│       ├── simple-pdf-extractor.js
│       └── structured-pdf-extractor.js
├── tests/                       # テスト関連
│   ├── test_*.js               # テストスクリプト
│   └── data/                   # テストデータ
│       └── *.json
├── docs/                        # ドキュメント
│   └── *.md                    # 各種ドキュメント
├── samples/                     # サンプルファイル
│   └── *.pdf                   # サンプルPDF
├── data/                        # データ保存
│   ├── uploads/                # アップロード済みファイル
│   ├── results/                # 処理結果
│   ├── form_analysis/          # フォーム分析結果
│   └── herp_output/            # HERP出力
└── scripts/                     # 分析・ユーティリティスクリプト
    └── *.js                    # 各種スクリプト
```

## 変更内容
1. **PDF処理モジュール**: `pdf_processing/` → `src/pdf_processing/`
2. **テストファイル**: ルートディレクトリ → `tests/`
3. **テストデータ**: ルートディレクトリ → `tests/data/`
4. **ドキュメント**: ルートディレクトリ → `docs/`
5. **サンプルPDF**: ルートディレクトリ → `samples/`
6. **分析スクリプト**: ルートディレクトリ → `scripts/`
7. **データ保存**: 各フォルダを`data/`配下に統合

## 更新されたパス
- server.jsのrequireパス: `'./pdf_processing/simple-pdf-extractor'` → `'./src/pdf_processing/simple-pdf-extractor'`
- multerの保存先: `'uploads/'` → `'data/uploads/'`
- フォーム分析の保存先: `'form_analysis/'` → `'data/form_analysis/'`
- 処理結果の保存先: `'results/enhanced_jsons/'` → `'data/results/enhanced_jsons/'`

## 依存関係
すべての依存関係は保持され、パスが適切に更新されています。