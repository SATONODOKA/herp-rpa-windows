# 🚀 Serena MCP + ログ監視 自動起動ガイド

## 📋 概要
Cursorを開いた時に、Serena MCPとログ監視を自動で開始するスクリプトです。

## 🛠️ 使用方法

### 1. 完全自動起動（推奨）
```bash
./start_serena_with_logs.sh
```
- Serena MCPを新規起動
- 新しいログディレクトリを作成
- リアルタイムログ監視を開始

### 2. 簡単起動
```bash
./quick_start.sh
```
- 既存のログディレクトリを使用
- サーバーのみ起動
- 既存のログファイルを監視

## 📊 起動後の確認方法

### サーバーアクセス
- **メインアプリ**: http://localhost:3001
- **Chrome DevTools**: http://localhost:9222

### ログ監視
- **サーバーログ**: `tail -f server.log`
- **Serena MCPログ**: 自動で監視開始

## 🔧 トラブルシューティング

### ポートが使用中の場合
```bash
# 既存のプロセスを停止
pkill -f "node server.js"
pkill -f serena-mcp-server
```

### ログファイルが見つからない場合
```bash
# 最新のログディレクトリを確認
ls -la "/Users/satonodoka/Library/Application Support/Cursor/logs/" | tail -3
```

## 📝 注意事項
- 初回起動時はSerena MCPの接続に時間がかかる場合があります
- ログファイルは自動で作成されます
- 停止するには `Ctrl+C` を押してください

## 🎯 毎回の起動手順
1. ターミナルを開く
2. `cd /Users/satonodoka/Desktop/herpkyujinshutoku`
3. `./start_serena_with_logs.sh` または `./quick_start.sh`
4. ブラウザで http://localhost:3001 にアクセス
