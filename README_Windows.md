# HERP RPA Tool - Windows版

Windows環境専用のHERP求人データ自動転記ツールです。

## 🚀 クイックスタート

### 1. 初期セットアップ
```batch
# install.bat をダブルクリックして実行
install.bat
```

### 2. アプリケーション起動
```batch
# start.bat をダブルクリックして実行
start.bat
```

### 3. ブラウザでアクセス
- 自動的にブラウザが開きます
- または手動で http://localhost:3001 にアクセス

## 📋 システム要件

### 必須環境
- **OS**: Windows 10/11 (64bit)
- **Node.js**: 18.x 以上
- **ブラウザ**: Chrome または Microsoft Edge
- **メモリ**: 4GB以上推奨
- **ストレージ**: 2GB以上の空き容量

### 権限について
- 初回セットアップ時は**管理者権限**で実行することを推奨
- Windows Defender の警告が表示される場合があります（許可してください）

## 🔧 Windows固有の設定

### ブラウザ自動検出
システムは以下の順序でブラウザを検索します：
1. `C:\Program Files\Google\Chrome\Application\chrome.exe`
2. `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
3. `C:\Program Files\Microsoft\Edge\Application\msedge.exe`
4. `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

### ファイルパス処理
- Windows特有のバックスラッシュ (`\`) パスを自動処理
- ファイルロック問題に対応したリトライ機構
- 長いファイルパスに対応

### セキュリティ設定
- Windows Defender 除外推奨フォルダ：
  - プロジェクトルートフォルダ
  - `node_modules` フォルダ

## 📁 フォルダ構造

```
herpkyujinshutoku/
├── input/              # 入力ファイル
│   ├── ready/         # 処理待ちファイル
│   └── samples/       # サンプルファイル
├── output/            # 出力ファイル
│   ├── success/       # 処理成功ファイル
│   ├── failed/        # 処理失敗ファイル
│   └── temp/          # 一時ファイル
├── logs/              # ログファイル
│   ├── process/       # 処理ログ
│   ├── error/         # エラーログ
│   └── audit/         # 監査ログ
├── archive/           # アーカイブ
├── src/               # ソースコード
├── workflows/         # 自動化ワークフロー
├── config/            # 設定ファイル
├── public/            # Webインターフェース
├── start.bat          # 起動スクリプト
├── install.bat        # セットアップスクリプト
└── server.js          # メインサーバー
```

## ⚙️ 設定ファイル

### `config/app.json`
```json
{
  "retention": {
    "output": {
      "temp": { "hours": 24 },
      "failed": { "days": 7 },
      "success": { "days": 30 }
    },
    "logs": {
      "process": { "days": 90 }
    }
  }
}
```

## 🚨 トラブルシューティング

### よくある問題

#### 1. Node.js がインストールされていない
```
Error: Node.js がインストールされていません
```
**解決方法**: https://nodejs.org/ からLTS版をダウンロード・インストール

#### 2. ブラウザが起動しない
```
ブラウザ起動エラー: Failed to launch browser
```
**解決方法**: Chrome または Edge をインストール

#### 3. ポート3001が使用中
```
Error: listen EADDRINUSE :::3001
```
**解決方法**: タスクマネージャーでNode.jsプロセスを終了

#### 4. ファイル削除エラー
```
EBUSY: resource busy or locked
```
**解決方法**: 自動リトライ機構が動作します（数秒待機）

#### 5. プロキシ環境
```
npm install に失敗
```
**解決方法**: npm プロキシ設定
```batch
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080
```

### ログ確認方法
- **処理ログ**: `logs/process/` フォルダ
- **エラーログ**: `logs/error/` フォルダ
- **コンソール出力**: start.bat 実行時のウィンドウ

### パフォーマンス最適化
1. **Windows Defender 除外設定**
   - プロジェクトフォルダを除外リストに追加
   - リアルタイム保護の例外設定

2. **ファイアウォール設定**
   - Node.js のネットワークアクセスを許可
   - ポート3001の通信を許可

3. **システム要件**
   - メモリ使用量: 約500MB-1GB
   - CPU使用率: 通常時10%以下

## 🔄 自動クリーンアップ

Windows環境では以下の自動クリーンアップが動作します：

- **一時ファイル**: 24時間後に削除
- **失敗ファイル**: 7日後に削除  
- **成功ファイル**: 30日後にアーカイブ
- **プロセスログ**: 90日後にアーカイブ

## 📞 サポート

問題が解決しない場合：
1. ログファイルを確認
2. Windows イベントログを確認
3. システム管理者に相談

---

**注意**: このツールは業務自動化を目的としています。使用前に社内規定を確認してください。