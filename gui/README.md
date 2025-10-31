# ESP32 LiDAR Point Cloud Visualization — アルゴリズムと実装の詳細

この `gui` ディレクトリは、ESP32から送信される2D LiDAR（360点、1°分解能）を受信して可視化し、ドーナツ状キーボード上で足を検出して音を鳴らすデモアプリケーションです。

以下は実装（主に `src/components/LidarVisualizer.jsx`）のアルゴリズム解説です。動作原理・主要計算・設計理由・調整箇所を中心に詳述します。

## 高レベルの処理フロー
1. WebSocket を開き、ESP32 の WebSocket サーバ（通常 ws://<esp32-ip>:81/）に接続する。
2. 受信データがバイナリなら LiDAR パケットとしてパースする。
3. 距離配列（360 × float32）を取り出し、Three.js の点群の positions 属性を更新して可視化する。
4. 各角度で「ドーナツ鍵盤領域に含まれるか」「距離が閾値を下回るか」を判定し、足を検出する。
5. 検出した鍵盤インデックスに対応する音を Web Audio API で再生。継続中の音は再起動しない（連打防止）。
6. 鍵盤メッシュの色を変えて視覚的にフィードバックする。

## データプロトコル（簡潔）
- Header (8 bytes): type:uint8 (0x01 = LiDAR), reserved:uint8, point_count:uint16 (360), timestamp:uint32 (ms)
- Payload: 360 個の float32（距離、単位：m、角度は 0° 〜 359°）

Ping は JSON でやりとりし RTT 測定に利用します。

## 受信処理のアルゴリズム（コードに対応）
ws.onmessage の中で以下を行います（擬似コード）：

1) バイナリ判定
  if event.data instanceof ArrayBuffer -> parse as LiDAR

2) ヘッダ取得
  const buffer = new Uint8Array(event.data)
  const type = buffer[0]
  const pointCount = new Uint16Array(buffer.buffer, 2, 1)[0]
  const timestamp = new Uint32Array(buffer.buffer, 4, 1)[0]

3) 距離配列
  const distances = new Float32Array(buffer.buffer, 8, pointCount)

4) 点群の更新
  for i in 0..359:
    angleRad = (i + angleOffset) * PI/180
    x = cos(angleRad) * distances[i]
    y = 0
    z = sin(angleRad) * distances[i]
    positions[3*i + 0] = x
    positions[3*i + 1] = y
    positions[3*i + 2] = z

  注: 実装では LiDAR と Three.js の座標系合わせのために角度に -90° オフセットを適用しています (前方を 0 度に合わせるため)。

5) FPS / フレームカウントの更新

## 足検出アルゴリズム（重要）
鍵盤は円環（ドーナツ）上に配置されています。検出は以下の手順で行います。

1) パラメータ
  - innerRadius, outerRadius: ドーナツの内外半径（m）
  - startAngle, endAngle: 鍵盤配置の角度範囲（deg）
  - detectionThreshold: 検出閾値（m）

2) 各 LiDAR 角度 i について
  - angleDeg = i - 90（コード内のオフセットで前方を0にしている）
  - distance = distances[i]
  - 角度が startAngle <= angleDeg <= endAngle か確認
  - 距離が innerRadius <= distance <= outerRadius か確認
  - baselineDistance = (innerRadius + outerRadius) / 2
  - if distance < baselineDistance - detectionThreshold なら "足あり" と判定

3) 鍵盤へのマッピング
  - angleRange = endAngle - startAngle
  - degreesPerKey = angleRange / numKeys
  - relativeAngle = angleDeg - startAngle
  - keyIndex = floor(relativeAngle / degreesPerKey)

設計理由:
- baselineDistance を使うことで内側/外側どちらに偏った鍵盤でも閾値の判定を統一できます。

## 連打（うなり）抑制の対策
頻繁な検出で音が「リスタート」すると連打感・うなりが出ます。対策として実装している点:
- `PianoSynth.playNote` は「既に同名の音が再生中なら何もしない」。これにより同じ鍵盤が継続して検出されても再起動を防ぐ。
- 鍵盤が検出から外れたときのみ `stopNote` を呼んで音を消す。

追加改善案（将来）:
- 検出のデバウンス: ある鍵盤を "N フレーム継続で検出" してからオンにする。
- 短時間の断続検出は無視するヒステリシス。

## 音声合成（PianoSynth）の実装ノート
- Web Audio API を使用。各ノートは独立した OscillatorNode と GainNode の組み合わせ。
- 基本波形: sine（任意に変更可能）
- アタック: gain を 0 → 0.3 に 0.01s で ramp
- リリース: stop 時に 0.1s のフェードアウト
- オクターブシフト: `shiftedFreq = baseFreq * 2 ** octaveShift`（UI の +/− で -2〜+2）

実装上の注意:
- ブラウザの自動再生ポリシーのため、ページで一度ユーザーがクリックして AudioContext を `resume()` する必要があります（UI で指示あり）。

## 鍵盤の3Dジオメトリ
- 各鍵盤はドーナツのセグメントとして `THREE.Shape` で構成。
- 黒鍵は白鍵より内周を一段狭くし、少し上に置くことで視認性を向上。
- 境界線は `THREE.EdgesGeometry` と `THREE.LineSegments` で描画し、白鍵の継ぎ目が見やすいようにしている。

## UI・操作まとめ
- 画面クリック: 音声を有効化（AudioContext.resume）
- 右上: ピアノ設定表示、オクターブの +/− ボタン（実際に押すと既存の音は stop されます）
- 中央上: 現在演奏中の音の表示

## 実行方法
```bash
cd gui
npm install
npm run dev   # 開発サーバー
# または
npm run build # 本番ビルド
```

ブラウザで開いたらページを一度クリックして音を有効化してから、ESP32 を接続してください。

## トラブルシューティング（よくある原因）
- 音が出ない: ページ未クリックで AudioContext が suspend 状態なことが多い。UI をクリックして有効化してください。
- 音がチラつく/連打に聞こえる: 既に実装している playNote の再起動防止に加え、検出のデバウンスを検討してください。
- 鍵盤の向きが合わない: `PIANO_CONFIG.startAngle`/`endAngle` とコード内の角度オフセット（-90°）を調整して合わせてください。

---
この README は `src/components/LidarVisualizer.jsx` に書かれた処理ロジックの実装メモです。細かい数値（閾値、半径、角度）は設置環境（LiDAR の高さ・角度・床材）によって調整が必要です。

