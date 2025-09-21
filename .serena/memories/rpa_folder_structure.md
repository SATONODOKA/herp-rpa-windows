# RPA標準フォルダ構造

## 現在のフォルダ構成
```
herpkyujinshutoku/
├── input/                # 入力ファイル（階層浅い、ユーザーアクセスしやすい）
│   ├── ready/           # 処理待ちファイル
│   └── samples/         # サンプルファイル
├── output/              # 出力結果（階層浅い、結果確認しやすい）
│   ├── success/         # 成功した処理結果
│   ├── failed/          # 失敗した処理結果
│   └── temp/            # 一時ファイル
├── logs/                # ログファイル
│   ├── process/         # 処理ログ
│   ├── error/           # エラーログ
│   └── audit/           # 監査ログ
├── config/              # 設定ファイル
│   └── app.json         # アプリケーション設定
├── workflows/           # 自動化ワークフロー
│   ├── main/            # メインプロセス
│   └── utilities/       # ユーティリティ（cleanup.js等）
├── src/                 # ソースコード
│   ├── extractors/      # PDF抽出モジュール
│   └── processors/      # データ処理モジュール
├── public/              # フロントエンド
├── tests/               # テストファイル
├── archive/             # アーカイブ（古いデータ）
└── server.js            # メインサーバー
```

## データ保存ルール
- **input/ready**: 処理後即削除
- **input/samples**: 永続保存（テスト用）
- **output/success**: 30日間保存 → archive移動
- **output/failed**: 7日間保存 → 削除
- **output/temp**: 24時間後に自動削除
- **logs/process**: 90日間保存
- **logs/error**: 180日間保存
- **logs/audit**: 1年間保存
- **archive**: 1年後に圧縮、2年後に削除

## 自動クリーンアップ
`workflows/utilities/cleanup.js`が毎日午前2時に自動実行され、古いファイルを整理します。

## パス更新
- PDF抽出: `./src/extractors/simple-pdf-extractor`
- アップロード先: `input/ready/`
- 成功結果: `output/success/`
- プロセスログ: `logs/process/`

## 利点
1. **アクセスしやすい**: input/outputが階層浅い
2. **自動整理**: 古いファイルは自動的にアーカイブ/削除
3. **監査対応**: 監査ログを1年間保持
4. **標準準拠**: UiPath等のRPAツール標準に準拠