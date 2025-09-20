#!/bin/bash

# Serena MCP + ログ監視 自動起動スクリプト
echo "🚀 Serena MCP + ログ監視を開始します..."

# プロジェクトディレクトリに移動
cd /Users/satonodoka/Desktop/herpkyujinshutoku

# 既存のプロセスを停止
echo "🔧 既存のプロセスを停止中..."
pkill -f serena-mcp-server 2>/dev/null || true
pkill -f "tail -f.*serena" 2>/dev/null || true
pkill -f "tail -f server.log" 2>/dev/null || true

# 少し待機
sleep 2

# 現在時刻でログディレクトリを作成
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
LOG_DIR="/Users/satonodoka/Library/Application Support/Cursor/logs/${TIMESTAMP}/window1/exthost/anysphere.cursor-retrieval"
mkdir -p "$LOG_DIR"

# Serenaログファイルを作成
SERENA_LOG="$LOG_DIR/MCP user-serena.log"
touch "$SERENA_LOG"

echo "📊 ログディレクトリ: $LOG_DIR"
echo "📊 Serenaログファイル: $SERENA_LOG"

# Serena MCPを起動
echo "🚀 Serena MCPを起動中..."
uvx --from git+https://github.com/oraios/serena serena-mcp-server --context ide-assistant &
SERENA_PID=$!

# 少し待機
sleep 3

# ログ監視を開始
echo "📊 ログ監視を開始中..."
tail -f server.log &
tail -f "$SERENA_LOG" &

echo "✅ 起動完了！"
echo "📊 Serena MCP PID: $SERENA_PID"
echo "📊 ログファイル: $SERENA_LOG"
echo "📊 サーバー: http://localhost:3001"
echo ""
echo "🛑 停止するには Ctrl+C を押してください"

# プロセスを待機
wait
