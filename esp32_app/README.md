# ESP32 LiDAR Data Generator

WebSocket経由でLiDARデータを送信するESP32アプリケーション。

## 機能

- **LiDARデータ送信**: 10Hzでバイナリデータ送信
- **Pingエコーバック**: RTT測定をサポート
- **シリアルコマンド**: リアルタイムで波形パターンを変更

## シリアルコマンド

シリアルモニタで以下のキーを入力:

- **0**: デフォルト（動的な円パターン）
- **1**: 正方形パターン
- **2**: 三角形パターン  
- **3**: ランダムパターン
- **h**: ヘルプ表示

## 通信確認方法

1. ESP32にプログラムを書き込む
2. シリアルモニタを開く（921600 baud）
3. ブラウザでWebアプリを開く
4. シリアルモニタで `0`, `1`, `2`, `3` を入力
5. ブラウザの点群が変化することを確認

## プロトコル

### LiDARデータ（バイナリ、10Hz）
```
[Header: 8 bytes]
  - type: 0x01
  - reserved: 0x00
  - point_count: 360
  - timestamp: uint32_t

[Data: 360 × 4 bytes]
  - distance: float × 360
```

### Ping（JSON、1秒間隔、自動）
```json
{"type":"ping","id":123,"t":1234567890}
```

## WiFi設定

```cpp
const char *wifi_ssid = "raptor";
const char *wifi_pass = "12345678";
```

## アクセス方法

- HTTP: `http://<ESP32_IP>/`
- WebSocket: `ws://<ESP32_IP>:81/`
