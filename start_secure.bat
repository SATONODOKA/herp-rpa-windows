@echo off
echo ================================
echo HERP RPA セキュア環境起動
echo ================================

REM Node.js Portable パス設定
set NODE_PATH=%~dp0runtime\nodejs
set PATH=%NODE_PATH%;%PATH%

REM Node.js の存在確認
if not exist "%NODE_PATH%\node.exe" (
    echo Error: Node.js Portable が見つかりません
    echo setup_portable.bat を先に実行してください
    pause
    exit /b 1
)

echo Node.js Portable 環境を使用します
echo パス: %NODE_PATH%
echo.

REM バージョン表示
echo Node.js バージョン:
"%NODE_PATH%\node.exe" --version
echo.

REM 依存関係チェック
if not exist "node_modules" (
    echo Error: 依存関係が見つかりません
    echo setup_portable.bat を先に実行してください
    pause
    exit /b 1
)

REM 必要なディレクトリの存在確認・作成
if not exist "input\ready" mkdir "input\ready"
if not exist "output\success" mkdir "output\success"
if not exist "logs\process" mkdir "logs\process"

echo 必要なフォルダ構造を確認しました
echo.

REM セキュア環境用の環境変数設定
set HERP_SECURE_MODE=true
set HERP_OFFLINE_MODE=true
set NODE_ENV=production

echo セキュア環境モードで起動します...
echo ブラウザで http://localhost:3001 にアクセスしてください
echo.
echo 終了するには Ctrl+C を押してください
echo ================================
echo.

REM サーバー起動
"%NODE_PATH%\node.exe" server.js

pause