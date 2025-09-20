# 推奨コマンド集

## 開発・実行コマンド
```bash
# サーバー起動
npm start

# 依存関係インストール
npm install

# パッケージ更新
npm update
```

## デバッグ・テストコマンド
```bash
# ログファイル確認
tail -f server.log

# アップロードファイル確認
ls -la uploads/

# 結果ファイル確認
ls -la results/enhanced_jsons/
```

## Gitコマンド
```bash
# 変更をステージング
git add .

# コミット
git commit -m "メッセージ"

# プッシュ
git push origin main

# ブランチ作成
git checkout -b feature/新機能名
```

## ファイル操作コマンド
```bash
# プロジェクトルートに移動
cd /Users/satonodoka/Desktop/herpkyujinshutoku

# ファイル検索
find . -name "*.js" -type f

# ログ検索
grep -r "エラー" server.log
```

## システムコマンド（macOS）
```bash
# プロセス確認
ps aux | grep node

# ポート使用状況確認
lsof -i :3000

# メモリ使用量確認
top -o cpu
```