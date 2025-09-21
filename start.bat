@echo off
echo ================================
echo HERP RPA Tool for Windows
echo ================================

REM Node.js バージョンチェック
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js がインストールされていません
    echo https://nodejs.org/ からダウンロードしてインストールしてください
    pause
    exit /b 1
)

echo Node.js 環境を確認しました

REM 必要なディレクトリを作成
if not exist "input\ready" mkdir "input\ready"
if not exist "input\samples" mkdir "input\samples"
if not exist "output\success" mkdir "output\success"
if not exist "output\failed" mkdir "output\failed"
if not exist "output\temp" mkdir "output\temp"
if not exist "logs\process" mkdir "logs\process"
if not exist "logs\error" mkdir "logs\error"
if not exist "logs\audit" mkdir "logs\audit"
if not exist "archive" mkdir "archive"

echo 必要なディレクトリを作成しました

REM 依存関係のインストール
if not exist "node_modules" (
    echo 依存関係をインストールしています...
    npm install
    if %errorlevel% neq 0 (
        echo Error: 依存関係のインストールに失敗しました
        pause
        exit /b 1
    )
)

echo サーバーを起動しています...
echo ブラウザで http://localhost:3001 にアクセスしてください
echo.
echo 終了するには Ctrl+C を押してください
echo ================================

node server.js