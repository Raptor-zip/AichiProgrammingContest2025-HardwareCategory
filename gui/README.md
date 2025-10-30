# ESP32 LiDAR Point Cloud Visualization

ESP32とWebSocketを使った2D LiDARデータのリアルタイム可視化システム。Three.jsで3D描画し、Ping測定機能も統合。

## 機能

- **LiDARデータ可視化**: 360°、1度分解能のLiDAR点群をリアルタイム表示
- **WebSocket通信**: バイナリプロトコルで効率的なデータ転送（10Hz、約14.5KB/秒）
- **Ping測定**: WebSocket RTT（Round Trip Time）測定機能
- **3D描画**: Three.jsによる滑らかな3D描画とマウス操作

## プロトコル仕様

### LiDARデータ（バイナリ）

```
[Header: 8 bytes]
  - type: uint8_t (0x01 = LiDAR data)
  - reserved: uint8_t (0x00)
  - point_count: uint16_t (360)
  - timestamp: uint32_t (milliseconds)

[Data: 360 × 4 bytes]
  - distance: float32 × 360 points (0°〜359°)
```

### Pingデータ（JSON）

```json
{
  "type": "ping",
  "id": 123,
  "t": 1234567890
}
```

## 開発

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev
# → http://localhost:3000/

# プロダクションビルド
npm run build
# → dist/app.js, dist/app.css が生成される
```

## ESP32デプロイ

1. `npm run build` でビルド
2. `dist/app.js` と `dist/app.css` をGitHubにコミット＆プッシュ
3. ESP32のHTMLが自動的にCDN経由で最新版を読み込む

## 操作方法

- **マウスドラッグ**: 視点回転
- **マウスホイール**: ズーム
- **Start Ping ボタン**: Ping測定開始/停止

## 技術スタック

- React 18
- Three.js 0.180
- Vite 5
- WebSocket (バイナリ + JSON)
