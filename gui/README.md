# ESP32 WebSocket Ping測定GUI (React版)

ESP32とのWebSocket通信でpingの往復時間(RTT)を測定するReactアプリケーションです。

## 特徴

- React 18とViteを使用した高速な開発環境
- カスタムフックでWebSocketロジックを管理
- コンポーネントベースの設計
- レスポンシブデザイン
- リアルタイムな統計情報表示
- 通信ログの表示(最新200件)

## セットアップ

### 依存関係のインストール

```bash
npm install
```

### 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

### ビルド

```bash
npm run build
```

ビルド結果は `dist` フォルダに生成されます。

### プレビュー

```bash
npm run preview
```

## プロジェクト構造

```
gui/
├── src/
│   ├── components/          # Reactコンポーネント
│   │   ├── ConnectionStatus.jsx
│   │   ├── ControlPanel.jsx
│   │   ├── Statistics.jsx
│   │   └── LogTable.jsx
│   ├── hooks/              # カスタムフック
│   │   └── useWebSocket.js
│   ├── App.jsx             # メインアプリケーション
│   ├── App.css             # アプリケーションスタイル
│   ├── main.jsx            # エントリーポイント
│   └── index.css           # グローバルスタイル
├── index.html              # HTMLテンプレート
├── vite.config.js          # Vite設定
└── package.json            # 依存関係
```

## 使い方

1. ESP32がWebSocketサーバー(ポート81)を起動していることを確認
2. アプリケーションを起動すると自動的にWebSocketに接続
3. 送信間隔を設定(デフォルト: 1000ms)
4. 「開始」ボタンをクリックしてping測定を開始
5. 「停止」ボタンで測定を停止

## 技術スタック

- **React 18**: UIライブラリ
- **Vite**: ビルドツール
- **WebSocket API**: リアルタイム通信
- **CSS3**: スタイリング

## 旧バージョンからの変更点

- バニラJavaScriptからReactへ移行
- 状態管理をReact Hooksで実装
- コンポーネントベースの設計により保守性が向上
- Viteによる高速な開発体験
