# 求人照合RPAツール（rirekisho特化版）プロジェクト概要

## プロジェクトの目的
- PDFから抽出された求人情報をHERPサイトの求人と自動照合
- 間違った求人への応募を防ぐため、厳格な安全性チェックを実装
- rirekisho形式PDFファイルから履歴書情報を自動抽出
- RAコメントから求人名と追加必須項目を解析

## 技術スタック
- **バックエンド**: Node.js + Express
- **PDF処理**: pdf-parse ライブラリ
- **ブラウザ自動化**: Puppeteer
- **ファイルアップロード**: Multer
- **CORS**: cors ライブラリ

## 主要機能
1. **PDF処理機能** (`pdf_processing/simple-pdf-extractor.js`)
   - rirekisho形式履歴書PDFから基本情報を自動抽出
   - 氏名、年齢、電話番号、メールアドレス
   - 現所属、最終学歴、推薦時コメント、職務要約

2. **RAコメント処理機能** (`server.js`)
   - 複雑な形式のRAコメントから求人名を抽出
   - 追加必須項目の自動検出
   - 安全性チェックと信頼度計算

3. **求人マッチング機能**
   - HERPサイトとの厳格な照合
   - 安全性を最優先としたマッチングロジック

4. **ブラウザ自動化**
   - Puppeteerを使用したHERPサイト操作
   - 推薦ボタンの自動クリック

## プロジェクト構造
```
herpkyujinshutoku/
├── server.js                    # メインサーバーファイル
├── pdf_processing/              # PDF処理モジュール
│   ├── simple-pdf-extractor.js  # シンプルPDF抽出器
│   └── structured-pdf-extractor.js # 構造化PDF抽出器
├── public/                      # フロントエンドファイル
├── uploads/                     # アップロードファイル保存
├── results/                     # 処理結果保存
└── form_analysis/              # フォーム分析結果
```