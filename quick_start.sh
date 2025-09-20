#!/bin/bash

# 簡単起動スクリプト
echo "�� 簡単起動中..."

# プロジェクトディレクトリに移動
cd /Users/satonodoka/Desktop/herpkyujinshutoku

# サーバーを起動
echo "🌐 サーバーを起動中..."
node server.js &
SERVER_PID=$!

# 少し待機
sleep 2

# 最新のログディレクトリを取得
LATEST_LOG_DIR=$(ls -t "/Users/satonodoka/Library/Application Support/Cursor/logs/" | head -1)
SERENA_LOG="/Users/satonodoka/Library/Application Support/Cursor/logs/${LATEST_LOG_DIR}/window1/exthost/anysphere.cursor-retrieval/MCP user-serena.log"

if [ -f "$SERENA_LOG" ]; then
    echo "📊 既存のログファイルを監視: $SERENA_LOG"
    tail -f server.log &
    tail -f "$SERENA_LOG" &
else
    echo "📊 新しいログディレクトリを作成中..."
    TIMESTAMP=$(date +%Y%m%dT%H%M%S)
    LOG_DIR="/Users/satonodoka/Library/Application Support/Cursor/logs/${TIMESTAMP}/window1/exthost/anysphere.cursor-retrieval"
    mkdir -p "$LOG_DIR"
    touch "$LOG_DIR/MCP user-serena.log"
    tail -f server.log &
    tail -f "$LOG_DIR/MCP user-serena.log" &
fi

echo "✅ 起動完了！"
echo "📊 サーバー: http://localhost:3001"
echo "🛑 停止するには Ctrl+C を押してください"

wait
