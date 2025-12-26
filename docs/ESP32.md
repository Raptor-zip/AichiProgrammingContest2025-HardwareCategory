## 概要

このドキュメントは、リポジトリ内の `esp32_app/esp32_app.ino` に基づく ESP32 ファームウェアの動作仕様と開発／導入手順を整理したものです。

ESP32 は LD06 LiDAR から `Serial2` 経由でデータを受信し、360点（1°刻み）の距離配列を内部バッファに格納します。1周が完了するたびに、バイナリ形式のフレームを WebSocket（ポート 81）で接続クライアントに送信します。HTTP サーバー（ポート 80）はビルド済み Web アセットを配信し、全アセットはgzip圧縮してフラッシュ（PROGMEM）から直接配信します。

---

## 機能概要

- LiDAR受信: `Serial2`（ボーレート 230400）から LD06 の測定データを受け取り、角度ごとの距離配列を構築。
- データ配信: 1周分のデータをまとめて WebSocket（ポート 81）でバイナリ配信（type=0x01）。
- Web UI: ESP32 がアクセスポイントとして動作し、内蔵 HTTP サーバーが `index.html` と圧縮済みアセットを配信。
- 設定操作: WebSocket のテキストコマンドで反射強度閾値（`THR:<0-255>`）を設定可能。

---

## ネットワーク設定（APモード）

- SSID: `ESP32-LiDAR`
- Password: `12345678`
- デフォルトIP: `192.168.4.1`（通常の softAP デフォルト）
- mDNS 名: `esp32.local`（`MDNS.begin("esp32")` による公開）

注: APモードはコード内で `WiFi.softAP(ap_ssid, ap_pass)` によって起動します。

---

## HTTP エンドポイント

ESP32 側で提供される静的リソースとパス:

- `/` → HTML（`index.html`、gzip 圧縮済み）
- `/app.css` → CSS（gzip 圧縮済み）
- `/app.js` → JavaScript（gzip 圧縮済み）
- `/favicon.svg` → SVG アイコン（gzip 圧縮済み）

配信時には以下ヘッダーが付与されます（重要）:

- `Content-Encoding: gzip`
- `Cache-Control: public, max-age=86400`

配信は `WebServer::send_P()` を使用して PROGMEM（フラッシュ）から直接読み出しています。

---

## WebSocket プロトコル（バイナリフレーム）

基本動作:

- ポート: `81`
- 送信: バイナリ（type 0x01）で LiDAR データを送信します。
- テキスト: Ping 応答やコマンド（`THR:` 等）はテキストメッセージとして扱います。

バイナリフレーム構造（リトルエンディアン）:

1. ヘッダ（8 バイト）
   - `uint8_t type` — 0x01（LiDARデータ）
   - `uint8_t reserved` — 0x00
   - `uint16_t point_count` — 通常 360
   - `uint32_t timestamp` — ESP32 の `millis()`

2. データ
   - `float32` × point_count（各点の距離メートル）

クライアント側では受信した ArrayBuffer を `DataView` / `Float32Array` でパースします。簡易受信例:

```js
const ws = new WebSocket('ws://esp32.local:81/');
ws.binaryType = 'arraybuffer';

ws.onmessage = (evt) => {
  if (typeof evt.data === 'string') { console.log('text', evt.data); return; }
  const buf = evt.data;
  const dv = new DataView(buf);
  const type = dv.getUint8(0);
  if (type !== 0x01) return;
  const pointCount = dv.getUint16(2, true);
  const timestamp = dv.getUint32(4, true);
  const floats = new Float32Array(buf, 8, pointCount);
  // floats[index] が degree に対応（0..pointCount-1）
}

function setThreshold(v) { ws.send('THR:' + Math.max(0, Math.min(255, v|0))); }
```

---

## シリアル接続（LD06）

- 使用ポート: `Serial2`
- ボーレート: `230400`
- ピン設定（実装例）: `Serial2.begin(230400, SERIAL_8N1, 25, 26);`（RX=25, TX=26 の例）

ファームウェア側では LD06 の受信コールバックで角度・距離・反射強度を受け取り、角度を度に丸めて内部バッファに格納し、周回（degree が前回より小さくなったとき）で `sendLidarData()` を呼び出して配信しています。

---

## 埋め込みアセット（ビルド & embed）

フロントエンドは Vite で開発／ビルドします。プロダクションでは以下のフローでアセットを ESP32 に埋め込みます。

1. `cd gui && npm run build` — `dist/index.html`, `dist/app.css`, `dist/app.js` を生成
2. `./build_and_embed.sh` — ビルド後に `tools/embed_assets.py` を呼び出して以下を実行:
   - `dist/*` と `public/favicon.svg` を gzip 圧縮
   - 圧縮バイナリを C の `uint8_t` 配列に変換し、`esp32_app/WebAssets.h` を生成
3. `esp32_app/WebAssets.h` をファームウェアに組み込み（`#include "WebAssets.h"`）してコンパイル・書き込み

生成された配列は `PROGMEM` としてフラッシュに置かれ、HTTP ハンドラは `send_P()` で直接送信します（RAMを節約）。

---

## ビルドと書き込み手順（簡易）

```bash
# ビルド & 埋め込み
./build_and_embed.sh

# Arduino IDE で esp32_app/esp32_app.ino をビルド&書き込み
```