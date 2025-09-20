# コードスタイル・規約

## 命名規則
- **関数名**: camelCase（例: `extractJobNameFromComplexFormat`）
- **変数名**: camelCase（例: `extractionResult`）
- **定数名**: UPPER_SNAKE_CASE（例: `SAFETY_CONFIG`）
- **クラス名**: PascalCase（例: `SimplePDFExtractor`）

## コメント規約
- **関数**: JSDoc形式のコメント
- **複雑なロジック**: 日本語での詳細説明
- **デバッグ用**: console.logで処理状況を出力

## エラーハンドリング
- try-catch文を使用
- エラーメッセージは日本語で記述
- 信頼度（confidence）による結果判定

## ファイル構造
- **メインファイル**: `server.js`
- **PDF処理**: `pdf_processing/` ディレクトリ
- **設定**: 定数としてファイル上部に定義

## ログ出力
- 処理開始: `console.log('🔍 処理開始...')`
- 成功: `console.log('✅ 成功メッセージ')`
- 警告: `console.log('⚠️ 警告メッセージ')`
- エラー: `console.log('❌ エラーメッセージ')`

## データ構造
- **抽出結果**: オブジェクト形式で統一
- **信頼度**: 0-100の数値で表現
- **エラー情報**: 配列形式で複数対応