@echo off
echo ================================
echo HERP RPA セキュア環境セットアップ
echo ================================

REM 管理者権限チェック
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限で実行してください
    echo 右クリック → 管理者として実行
    pause
    exit /b 1
)

echo セキュア環境向けセットアップを開始します...
echo.

REM Node.js Portable のダウンロードと設定
echo [1/4] Node.js Portable のダウンロード中...
if not exist "runtime\nodejs\node.exe" (
    echo Node.js が見つかりません
    echo 以下の手順で手動セットアップしてください:
    echo.
    echo 1. https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip をダウンロード
    echo 2. runtime\nodejs\ フォルダに展開
    echo 3. このスクリプトを再実行
    echo.
    pause
    exit /b 1
)

echo Node.js Portable が確認できました

REM PATH設定
set NODE_PATH=%~dp0runtime\nodejs
set PATH=%NODE_PATH%;%PATH%

echo [2/4] Node.js バージョン確認...
"%NODE_PATH%\node.exe" --version
if %errorlevel% neq 0 (
    echo Node.js の実行に失敗しました
    pause
    exit /b 1
)

REM 依存関係の確認とインストール
echo [3/4] 依存関係の確認中...
if not exist "node_modules" (
    echo 依存関係をインストールします（オフライン）...
    if exist "package-lock.json" (
        "%NODE_PATH%\npm.cmd" ci --offline --no-audit
    ) else (
        echo パッケージ情報が見つかりません
        echo オンライン環境で事前に 'npm install' を実行してください
        pause
        exit /b 1
    )
)

REM 必要なディレクトリ作成
echo [4/4] フォルダ構造を作成中...
if not exist "input\ready" mkdir "input\ready"
if not exist "input\samples" mkdir "input\samples"
if not exist "output\success" mkdir "output\success"
if not exist "output\failed" mkdir "output\failed"
if not exist "output\temp" mkdir "output\temp"
if not exist "logs\process" mkdir "logs\process"
if not exist "logs\error" mkdir "logs\error"
if not exist "logs\audit" mkdir "logs\audit"
if not exist "archive" mkdir "archive"

echo.
echo ================================
echo セットアップ完了!
echo ================================
echo.
echo セキュア環境での使用方法:
echo 1. start_secure.bat を実行してサーバーを起動
echo 2. ブラウザで http://localhost:3001 にアクセス
echo.
echo 注意: このバージョンはオフライン環境専用です
echo インターネット接続は不要です
echo.
pause