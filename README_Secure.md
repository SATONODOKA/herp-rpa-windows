# HERP RPA Tool - セキュア環境版

**⚠️ インターネット接続不要のセキュア環境専用バージョン**

## 🛡️ セキュア環境の特徴

- **オフライン完全対応**: インターネット接続不要
- **セルフコンテイン**: 外部依存関係なし
- **Portable実行**: レジストリ変更なし
- **機能制限なし**: すべての機能が利用可能

## 📦 パッケージ内容

```
herp-rpa-secure-package/
├── runtime/                    # 実行環境
│   ├── nodejs/                # Node.js Portable
│   └── chromium/              # Chromium Portable (オプション)
├── src/                       # アプリケーションソース
├── node_modules/              # 全依存関係（事前パッケージ済み）
├── config/                    # 設定ファイル
├── public/                    # Webインターフェース
├── input/, output/, logs/     # データフォルダ
├── .env                       # セキュア環境設定
├── setup_portable.bat        # 初期セットアップ
├── start_secure.bat          # セキュア起動
└── SETUP_GUIDE.txt           # セットアップガイド
```

## 🚀 セットアップ手順

### STEP 1: パッケージの配置
```bash
# セキュア環境にフォルダ全体をコピー
herp-rpa-secure-package/ → C:\Tools\
```

### STEP 2: Node.js Portable のセットアップ
1. **ダウンロード**: https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip
2. **展開**: `runtime\nodejs\` フォルダに展開
3. **確認**: `runtime\nodejs\node.exe` が存在することを確認

### STEP 3: ブラウザセットアップ (推奨)
**Option A: Chromium Portable (推奨)**
1. https://download-chromium.appspot.com/ から最新版をダウンロード
2. `runtime\chromium\` フォルダに展開
3. `runtime\chromium\chrome.exe` が存在することを確認

**Option B: システムブラウザ利用**
- Chrome または Edge がインストール済みの場合は自動検出

### STEP 4: 初期セットアップ実行
```batch
# 管理者権限で実行
setup_portable.bat
```

### STEP 5: アプリケーション起動
```batch
# セキュア環境で起動
start_secure.bat
```

## 🔧 セキュア環境固有の設定

### 環境変数 (.env)
```
HERP_SECURE_MODE=true
HERP_OFFLINE_MODE=true
NODE_ENV=production
```

### セキュリティ設定
- **ファイアウォール**: ポート3001の許可のみ
- **ウイルス対策**: フォルダ除外設定推奨
- **UAC**: 管理者権限での実行推奨

## 📁 フォルダ構造詳細

### 入力フォルダ
- `input/ready/` - 処理待ちファイル
- `input/samples/` - サンプルファイル

### 出力フォルダ  
- `output/success/` - 処理成功ファイル
- `output/failed/` - 処理失敗ファイル
- `output/temp/` - 一時ファイル

### ログフォルダ
- `logs/process/` - 処理ログ
- `logs/error/` - エラーログ
- `logs/audit/` - 監査ログ

## 🎯 使用方法

### 1. 基本操作
1. `start_secure.bat` でサーバー起動
2. ブラウザで http://localhost:3001 にアクセス
3. JSONファイルとPDFファイルをアップロード
4. 自動処理の実行・監視

### 2. セキュア環境での注意点
- **オフライン専用**: 外部通信は行いません
- **ローカル処理**: すべてローカルで完結
- **データ保持**: 処理データは自動クリーンアップ

## 🚨 トラブルシューティング

### よくある問題

#### 1. Node.js が見つからない
```
Error: Node.js Portable が見つかりません
```
**解決**: `runtime\nodejs\node.exe` の存在を確認

#### 2. ブラウザ起動失敗
```
ブラウザ起動エラー: Failed to launch browser
```
**解決**: Chromium Portable または システムブラウザを確認

#### 3. ポート使用中エラー
```
Error: listen EADDRINUSE :::3001
```
**解決**: タスクマネージャーでNode.jsプロセスを終了

#### 4. 権限エラー
```
Error: EACCES permission denied
```
**解決**: 管理者権限でコマンドプロンプトを起動

### ログ確認
- **起動ログ**: start_secure.bat 実行時のコンソール
- **処理ログ**: `logs/process/` フォルダ
- **エラーログ**: `logs/error/` フォルダ

## 🔒 セキュリティ考慮事項

### データの取り扱い
- **機密データ**: ローカル処理のみ
- **自動削除**: 設定された期間後に自動削除
- **外部送信**: 一切行いません

### システム設定
- **レジストリ**: 変更しません
- **システムファイル**: 影響しません  
- **ネットワーク**: ローカルホストのみ使用

## 📋 システム要件

### 最小要件
- **OS**: Windows 10/11 (64bit)
- **メモリ**: 4GB以上
- **ストレージ**: 2GB以上の空き容量
- **権限**: 管理者権限（推奨）

### 推奨環境
- **メモリ**: 8GB以上
- **CPU**: Intel Core i5 相当以上
- **ストレージ**: SSD推奨

## 📞 サポート情報

### パッケージ情報
- **Node.js**: v20.17.0 (LTS)
- **依存関係**: 完全パッケージ済み
- **ブラウザ**: Chromium Portable対応

### 制限事項
- インターネット接続は使用しません
- 外部APIへのアクセスはありません
- すべての処理はローカルで完結します

---

**注意**: このバージョンはセキュア環境専用です。通常の開発・テスト環境では標準版を使用してください。