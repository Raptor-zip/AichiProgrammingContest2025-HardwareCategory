## 概要

ESP32 は `Serial2` で LD06 LiDAR からデータを受け取り、360点（1°刻み）の距離配列を内部バッファに格納します。1周が完了するたびに、以下形式のバイナリフレームを WebSocket（ポート 81）で接続クライアントに送信します。また、1 秒毎に ping JSON を送る機能と、WebSocket 経由で閾値（反射強度フィルタ）を更新できます。

## データプロトコル
[データプロトコル詳細](../README.md#データプロトコル詳細)

## ブラウザ側（受信・パース例）

以下はバイナリフレームを受け取り、Float32Array に変換して 360 要素の配列を扱う簡易サンプルです（WebSocket API）。

```js
const ws = new WebSocket('ws://<ESP32_IP>:81/');
ws.binaryType = 'arraybuffer';

ws.onmessage = (evt) => {
  if (typeof evt.data === 'string') {
    // ping / テキストコマンドの応答
    console.log('text', evt.data);
    return;
  }
  const buf = evt.data; // ArrayBuffer
  const dv = new DataView(buf);
  const type = dv.getUint8(0);
  if (type !== 0x01) return; // LiDAR 以外は無視
  const pointCount = dv.getUint16(2, true);
  const timestamp = dv.getUint32(4, true);
  const floats = new Float32Array(buf, 8, pointCount);
  // floats は距離配列（meters）: index = degree (0..359)
  renderPointCloud(floats, timestamp);
}

// 閾値を送る例
function setThreshold(v) { ws.send('THR:' + Math.max(0, Math.min(255, v|0))); }
```