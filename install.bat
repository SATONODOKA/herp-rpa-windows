@echo off
echo ================================
echo HERP RPA Tool セットアップ
echo ================================

REM 管理者権限チェック
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 警告: 管理者権限で実行することを推奨します
    echo 一部の機能が正常に動作しない可能性があります
    echo.
    pause
)

REM Node.js バージョンチェック
echo Node.js 環境をチェックしています...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js がインストールされていません
    echo.
    echo 以下の手順でインストールしてください:
    echo 1. https://nodejs.org/ にアクセス
    echo 2. LTS版をダウンロード
    echo 3. インストール後、PCを再起動
    echo 4. このスクリプトを再実行
    echo.
    pause
    exit /b 1
)

echo Node.js が見つかりました
node --version
echo.

REM npm バージョンチェック
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: npm が利用できません
    pause
    exit /b 1
)

echo npm が利用可能です
npm --version
echo.

REM 必要なディレクトリを作成
echo 必要なフォルダ構造を作成しています...
if not exist "input\ready" mkdir "input\ready"
if not exist "input\samples" mkdir "input\samples"
if not exist "output\success" mkdir "output\success"
if not exist "output\failed" mkdir "output\failed"
if not exist "output\temp" mkdir "output\temp"
if not exist "logs\process" mkdir "logs\process"
if not exist "logs\error" mkdir "logs\error"
if not exist "logs\audit" mkdir "logs\audit"
if not exist "archive" mkdir "archive"
if not exist "public" mkdir "public"

echo フォルダ構造の作成が完了しました
echo.

REM 依存関係のインストール
echo 依存関係をインストールしています...
echo これには数分かかる場合があります...
npm install
if %errorlevel% neq 0 (
    echo.
    echo Error: 依存関係のインストールに失敗しました
    echo 以下を確認してください:
    echo - インターネット接続
    echo - ファイアウォール設定
    echo - 管理者権限での実行
    echo.
    pause
    exit /b 1
)

echo.
echo ================================
echo セットアップ完了!
echo ================================
echo.
echo 使用方法:
echo 1. start.bat をダブルクリックしてサーバーを起動
echo 2. ブラウザで http://localhost:3001 にアクセス
echo 3. JSONファイルとPDFファイルをアップロードして処理開始
echo.
echo 注意事項:
echo - 初回起動時は Windows Defender の警告が表示される場合があります
echo - Chromeまたは Microsoft Edge がインストールされている必要があります
echo - プロキシ環境では追加設定が必要な場合があります
echo.
pause