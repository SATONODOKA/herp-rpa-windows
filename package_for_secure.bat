@echo off
echo ================================
echo HERP RPA セキュア環境パッケージ作成
echo ================================

REM 管理者権限チェック
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限で実行してください
    pause
    exit /b 1
)

echo セキュア環境向けの完全パッケージを作成します...
echo.

REM 出力フォルダの準備
set OUTPUT_DIR=herp-rpa-secure-package
if exist "%OUTPUT_DIR%" (
    echo 既存のパッケージフォルダを削除しています...
    rmdir /s /q "%OUTPUT_DIR%"
)
mkdir "%OUTPUT_DIR%"

echo [1/5] アプリケーションファイルをコピー中...
REM アプリケーションファイルのコピー
xcopy /E /I /H /Y "src" "%OUTPUT_DIR%\src\"
xcopy /E /I /H /Y "config" "%OUTPUT_DIR%\config\"
xcopy /E /I /H /Y "public" "%OUTPUT_DIR%\public\"
xcopy /E /I /H /Y "workflows" "%OUTPUT_DIR%\workflows\"
copy /Y "server.js" "%OUTPUT_DIR%\"
copy /Y "package.json" "%OUTPUT_DIR%\"
copy /Y "package-lock.json" "%OUTPUT_DIR%\"
copy /Y "*.bat" "%OUTPUT_DIR%\"
copy /Y "*.md" "%OUTPUT_DIR%\"

echo [2/5] 依存関係をコピー中...
REM node_modules の完全コピー
if exist "node_modules" (
    xcopy /E /I /H /Y "node_modules" "%OUTPUT_DIR%\node_modules\"
) else (
    echo 警告: node_modules が見つかりません
    echo 事前に 'npm install' を実行してください
)

echo [3/5] フォルダ構造を作成中...
REM 必要なフォルダ構造
mkdir "%OUTPUT_DIR%\input\ready"
mkdir "%OUTPUT_DIR%\input\samples"
mkdir "%OUTPUT_DIR%\output\success"
mkdir "%OUTPUT_DIR%\output\failed"
mkdir "%OUTPUT_DIR%\output\temp"
mkdir "%OUTPUT_DIR%\logs\process"
mkdir "%OUTPUT_DIR%\logs\error"
mkdir "%OUTPUT_DIR%\logs\audit"
mkdir "%OUTPUT_DIR%\archive"
mkdir "%OUTPUT_DIR%\runtime\nodejs"
mkdir "%OUTPUT_DIR%\runtime\chromium"

echo [4/5] セキュア環境専用設定を作成中...
REM セキュア環境専用の設定ファイル
echo HERP_SECURE_MODE=true > "%OUTPUT_DIR%\.env"
echo HERP_OFFLINE_MODE=true >> "%OUTPUT_DIR%\.env"
echo NODE_ENV=production >> "%OUTPUT_DIR%\.env"

echo [5/5] セットアップガイドを作成中...
REM セットアップガイドの作成
(
echo # セキュア環境セットアップガイド
echo.
echo ## 1. Node.js Portable のセットアップ
echo 1. https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip をダウンロード
echo 2. runtime\nodejs\ フォルダに展開
echo.
echo ## 2. Chromium Portable のセットアップ ^(オプション^)
echo 1. https://download-chromium.appspot.com/ から Windows x64 版をダウンロード
echo 2. runtime\chromium\ フォルダに展開
echo 3. chrome.exe が runtime\chromium\chrome.exe になることを確認
echo.
echo ## 3. 起動方法
echo 1. setup_portable.bat を実行 ^(初回のみ^)
echo 2. start_secure.bat を実行
echo 3. ブラウザで http://localhost:3001 にアクセス
echo.
echo ## 注意事項
echo - インターネット接続は不要です
echo - Windows Defender の除外設定を推奨
echo - 管理者権限での実行を推奨
) > "%OUTPUT_DIR%\SETUP_GUIDE.txt"

echo.
echo ================================
echo パッケージ作成完了!
echo ================================
echo.
echo 作成されたパッケージ: %OUTPUT_DIR%
echo.
echo 次の手順:
echo 1. %OUTPUT_DIR% フォルダをセキュア環境にコピー
echo 2. SETUP_GUIDE.txt の手順に従ってセットアップ
echo 3. start_secure.bat で起動
echo.
echo パッケージサイズを確認しています...
dir "%OUTPUT_DIR%" /s
echo.
pause