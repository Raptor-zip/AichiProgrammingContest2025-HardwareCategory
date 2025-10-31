# SonicRing

## プロジェクト概要

このプロジェクトは、2D LiDAR センサーを使用して**足で演奏できるピアノ**を実現するインタラクティブシステムです。ESP32が LiDAR データをリアルタイム（10Hz）で WebSocket 経由で配信し、ブラウザ上の Three.js アプリケーションが点群を可視化しながら足の位置を検出して音を鳴らします。

### 主な特徴
- **リアルタイム可視化**: 360点の LiDAR 点群を Three.js で 3D レンダリング
- **ドーナツ状鍵盤**: 半円形（カスタマイズ可能）の鍵盤配置
- **純正律音階**: 整数比による美しい和音（Just Intonation）
- **3D 鍵盤表現**: ExtrudeGeometry による厚みのある鍵盤
- **音域シフト**: ±2オクターブの範囲調整が可能
- **WebSocket 自動再接続**: 接続が切れても自動で復旧

---

## システムアーキテクチャ

```mermaid
graph LR
    A[ESP32 + LiDAR] -->|WebSocket ws://IP:81/| B[ブラウザ]
    A -->|Binary: LiDAR Data 360 points| B
    A -->|JSON: Ping/Pong RTT測定| B
    B --> C[React + Three.js]
    C --> D[3D Visualization]
    C --> E[Web Audio API]
    E --> F[音声出力]

    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#bbf,stroke:#333,stroke-width:2px
    style E fill:#bfb,stroke:#333,stroke-width:2px
```

### 処理フロー（1フレーム）

```mermaid
flowchart TD
    A[WebSocket データ受信] --> B[バイナリパース]
    B --> C[Uint8Array → Float32Array]
    C --> D[座標変換: 極座標 → 直交座標]
    D --> E[Three.js BufferGeometry 更新]
    D --> F[足検出: ドーナツ領域チェック]
    F --> G[鍵盤マッピング: 角度 → インデックス]
    G --> H{境界マージン内?}
    H -->|Yes| I[音声制御: playNote/stopNote]
    H -->|No| J[スキップ]
    I --> K[視覚フィードバック: 色変更 + 3D押下]
    K --> L[レンダリング完了]

    style A fill:#e1f5ff
    style I fill:#ffe1e1
    style K fill:#ffe1ff
```

---

## データプロトコル詳細

### LiDAR データパケット構造

```
Offset  Size    Type        Description
------  ------  ----------  ----------------------------------
0       1       uint8       Packet Type (0x01 = LiDAR)
1       1       uint8       Reserved (future use)
2       2       uint16      Point Count (固定値: 360)
4       4       uint32      Timestamp (ms, ESP32起動からの経過時間)
8       1440    float32[]   Distance array (360 points × 4 bytes)
------  ------
Total:  1448 bytes
```

- **エンディアン**: リトルエンディアン（JavaScript の TypedArray のデフォルト）
- **距離単位**: メートル (m)
- **角度範囲**: 0° - 359°（1°刻み）
- **角度基準**: LiDAR の 0° = センサーの前方向（実装では -90° オフセットで調整）

### Ping/Pong プロトコル（RTT 測定）

```json
// クライアント → サーバー (Ping)
{
  "type": "ping",
  "id": 123,           // シーケンス番号
  "t": 1698765432100   // 送信時刻 (ms, performance.now() ベース)
}

// サーバー → クライアント (Pong)
{
  "type": "ping",      // そのまま返す
  "id": 123,
  "t": 1698765432100
}
```

- **RTT 計算**: `RTT = 受信時刻 - payload.t`
- **統計**: 直近30秒間の min/max/avg を計算
- **タイムアウト**: 3秒以内に応答がない場合、WebSocket を切断して再接続

---

## 座標系と角度変換

### LiDAR 座標系 vs Three.js 座標系

```mermaid
graph TD
    subgraph LiDAR["LiDAR 座標系 (センサー視点)"]
        L0["0° (前方)"]
        L90["90° (右)"]
        L180["180° (後方)"]
        L270["270° (左)"]
    end

    subgraph Three["Three.js 座標系 (Y-up 右手系)"]
        T_Z_POS["+Z (後方)"]
        T_X_POS["+X (右)"]
        T_Z_NEG["-Z (前方)"]
        T_X_NEG["-X (左)"]
        T_Y_POS["+Y (上)"]
    end

    L0 -."-90° オフセット".-> T_Z_NEG
    L90 -.-> T_X_NEG
    L180 -.-> T_Z_POS
    L270 -.-> T_X_POS

    style LiDAR fill:#ffe1e1
    style Three fill:#e1f5ff
```

### 変換アルゴリズム

```mermaid
sequenceDiagram
    participant Raw as 生データ (0°-359°)
    participant Rad as ラジアン変換
    participant Calc as 座標計算
    participant Pos as Three.js Position

    Raw->>Rad: angle = i * π / 180
    Rad->>Calc: distance = distances[i]
    Calc->>Pos: X = -cos(angle) * distance
    Calc->>Pos: Y = 0.1 (固定高さ)
    Calc->>Pos: Z = sin(angle) * distance

    Note over Calc,Pos: -90°オフセットで<br/>前方を-Z方向に配置
```

```javascript
// コード内の実装
for (let i = 0; i < 360; i++) {
    const angle = (i * Math.PI) / 180.0;  // ラジアン変換
    const distance = distances[i];

    // Three.js座標系に配置 (LiDARの0°を前方に合わせるため-90°オフセット済み)
    positions[i * 3 + 0] = -Math.cos(angle) * distance;  // X座標 (左右反転)
    positions[i * 3 + 1] = 0.1;                          // Y座標 (鍵盤より上)
    positions[i * 3 + 2] = Math.sin(angle) * distance;   // Z座標
}
```

**重要な調整点**:
- `-Math.cos(angle)`: X軸を反転（Three.js の右手座標系に合わせる）
- `-90°` オフセット: LiDAR の 0° を前方（-Z方向）に配置
- `angleDeg = i - 90` で鍵盤検出時に角度を調整

---

## 足検出アルゴリズム

### 検出の3段階フィルタリング

```mermaid
flowchart TD
    Start[LiDAR点 i, distance] --> A1{角度フィルタ}
    A1 -->|startAngle ≤ angleDeg ≤ endAngle| A2{距離フィルタ}
    A1 -->|範囲外| Skip1[スキップ]

    A2 -->|innerRadius ≤ distance ≤ outerRadius| A3[鍵盤マッピング]
    A2 -->|範囲外| Skip2[スキップ]

    A3 --> A4[keyIndex = floor relativeAngle / degreesPerKey]
    A4 --> A5[positionInKey 計算]
    A5 --> A6{境界マージン}

    A6 -->|margin ≤ pos ≤ 1-margin| Detect[検出成功!]
    A6 -->|境界部分| Skip3[除外]

    style Detect fill:#9f9,stroke:#333,stroke-width:2px
    style Skip1 fill:#f99,stroke:#333
    style Skip2 fill:#f99,stroke:#333
    style Skip3 fill:#f99,stroke:#333
```

```javascript
// 1. 角度フィルタ: 鍵盤の配置範囲内か？
if (angleDeg >= startAngle && angleDeg <= endAngle) {

    // 2. 距離フィルタ: ドーナツ領域内か？
    if (distance >= innerRadius && distance <= outerRadius) {

        // 3. 鍵盤マッピング: どの鍵盤か？
        const relativeAngle = angleDeg - startAngle;
        const keyIndex = Math.floor(relativeAngle / degreesPerKey);

        // 4. 境界マージン: 鍵盤の境界部分を除外
        const positionInKey = (relativeAngle % degreesPerKey) / degreesPerKey;
        const margin = boundaryMarginRatio / 2;  // デフォルト: 0.2 → 各側0.1

        if (positionInKey >= margin && positionInKey <= (1.0 - margin)) {
            // 検出成功！
            detectedNotes.push(note);
        }
    }
}
```

### パラメータの意味

| パラメータ | デフォルト値 | 説明 |
|-----------|-------------|------|
| `innerRadius` | 1.0 m | ドーナツの内側半径 |
| `outerRadius` | 1.3 m | ドーナツの外側半径 |
| `startAngle` | 50° | 鍵盤配置の開始角度（LiDAR基準-90°） |
| `endAngle` | 270° | 鍵盤配置の終了角度 |
| `boundaryMarginRatio` | 0.2 (20%) | 鍵盤境界の除外割合 |

### 境界マージンの動作

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'fontSize':'16px'}}}%%
graph LR
    subgraph Key["鍵盤 N の幅 (角度)"]
        A["0.0<br/>(開始)"]
        B["0.1<br/>(除外)"]
        C["0.5<br/>(中央)"]
        D["0.9<br/>(除外)"]
        E["1.0<br/>(終了)"]
    end

    A -.-> B
    B -->|有効範囲| C
    C -->|有効範囲| D
    D -.-> E

    style B fill:#f99
    style D fill:#f99
    style C fill:#9f9
```

**boundaryMarginRatio = 0.2 (20%) の場合:**
- **除外範囲**: 各側 10% (0.0-0.1 と 0.9-1.0)
- **有効範囲**: 中央 80% (0.1-0.9)

**設計理由**:
- 隣接する鍵盤の境界で誤検出を防ぐ
- 足が鍵盤の端にかかっても安定して検出
- UI で 0% - 50% の範囲で調整可能

### 連打（うなり）抑制

```mermaid
stateDiagram-v2
    [*] --> Idle: 初期状態
    Idle --> Playing: playNote(freq, name)
    Playing --> Playing: 同じ音で playNote<br/>(何もしない)
    Playing --> Idle: stopNote(name)

    note right of Playing
        オシレーター実行中
        再起動を防ぐ
    end note
```

```javascript
// PianoSynth.playNote() の実装
playNote(freq, noteName) {
    if (this.oscillators.has(noteName)) {
        // 既に再生中なら何もしない → 連打を防ぐ
        return;
    }

    // 新規オシレーター作成
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.01);  // アタック

    this.oscillators.set(noteName, { osc, gain, startTime: now });
}
```

**対策ポイント**:
1. 同じ音名が既に再生中なら `playNote` を無視
2. 足が離れて検出から外れたときのみ `stopNote` を呼ぶ
3. これにより「継続的な検出」で音が途切れず、連打音が出ない

---

## 音声合成システム

### 純正律（Just Intonation）の実装

```mermaid
graph TD
    C["C (1/1)"] --> CS["C# (16/15)"]
    CS --> D["D (9/8)"]
    D --> DS["D# (6/5)"]
    DS --> E["E (5/4)"]
    E --> F["F (4/3)"]
    F --> FS["F# (45/32)"]
    FS --> G["G (3/2)"]
    G --> GS["G# (8/5)"]
    GS --> A["A (5/3)"]
    A --> AS["A# (16/9)"]
    AS --> B["B (15/8)"]

    style C fill:#fff,stroke:#333,stroke-width:3px
    style CS fill:#333,color:#fff,stroke:#666
    style D fill:#fff,stroke:#333,stroke-width:3px
    style DS fill:#333,color:#fff,stroke:#666
    style E fill:#fff,stroke:#333,stroke-width:3px
    style F fill:#fff,stroke:#333,stroke-width:3px
    style FS fill:#333,color:#fff,stroke:#666
    style G fill:#fff,stroke:#333,stroke-width:3px
    style GS fill:#333,color:#fff,stroke:#666
    style A fill:#fff,stroke:#333,stroke-width:3px
    style AS fill:#333,color:#fff,stroke:#666
    style B fill:#fff,stroke:#333,stroke-width:3px
```

```javascript
// 基本音階定義（C4 = 264 Hz基準）
const BASE_NOTES = [
    { note: 'C',  ratio: 1,      isBlack: false },  // 1/1 (完全1度)
    { note: 'C#', ratio: 16/15,  isBlack: true  },  // 短2度
    { note: 'D',  ratio: 9/8,    isBlack: false },  // 長2度
    { note: 'D#', ratio: 6/5,    isBlack: true  },  // 短3度
    { note: 'E',  ratio: 5/4,    isBlack: false },  // 長3度
    { note: 'F',  ratio: 4/3,    isBlack: false },  // 完全4度
    { note: 'F#', ratio: 45/32,  isBlack: true  },  // 増4度
    { note: 'G',  ratio: 3/2,    isBlack: false },  // 完全5度
    { note: 'G#', ratio: 8/5,    isBlack: true  },  // 短6度
    { note: 'A',  ratio: 5/3,    isBlack: false },  // 長6度
    { note: 'A#', ratio: 16/9,   isBlack: true  },  // 短7度
    { note: 'B',  ratio: 15/8,   isBlack: false },  // 長7度
];
```

### 周波数計算

```mermaid
graph LR
    A[BASE_FREQ<br/>264 Hz] --> B[× ratio]
    B --> C[× 2^octave-4]
    C --> D[最終周波数]

    E["例: D4"] --> F["264 × 9/8"]
    F --> G["× 2^4-4 = × 1"]
    G --> H["= 297 Hz"]

    style D fill:#9f9
    style H fill:#9f9
```

**計算式:**
```
freq = BASE_FREQ × ratio × 2^(octave - 4)

例: D4 の周波数
  = 264 Hz × (9/8) × 2^(4-4)
  = 264 × 1.125 × 1
  = 297 Hz
```

### オクターブシフト

```mermaid
graph TD
    UI["UI +/- ボタン"] --> RS["rangeShift<br/>(-2 ~ +2)"]
    RS --> Calc["shiftedOctave = <br/>baseOctave + rangeShift"]

    Ex1["C3-B4"] --> Ex2["rangeShift = +1"]
    Ex2 --> Ex3["→ C4-B5"]

    style RS fill:#ff9
    style Ex3 fill:#9f9
```

```javascript
// UI の +/- ボタンで rangeShift を変更 (-2 ~ +2)
const shiftedOctave = baseOctave + rangeShift;

// 例: C3-B4 の範囲で rangeShift = +1 の場合
// → C4-B5 の範囲に変換
```

### Web Audio API の構成

```mermaid
graph TD
    Osc[OscillatorNode<br/>波形生成] --> Gain[GainNode<br/>音量制御]
    Gain --> Dest[AudioContext.destination<br/>出力]

    W1[sine] -.選択可能.-> Osc
    W2[triangle] -.-> Osc
    W3[sawtooth] -.デフォルト.-> Osc
    W4[square] -.-> Osc

    style Osc fill:#e1f5ff
    style Gain fill:#ffe1e1
    style Dest fill:#e1ffe1
```

**波形タイプ** (UI で選択可能):
- `sine` (サイン波): 純音、柔らかい
- `triangle` (三角波): やや丸い倍音
- `sawtooth` (ノコギリ波): 豊かな倍音、ピアノに近い（デフォルト）
- `square` (矩形波): 鋭い倍音、オルガン的

**エンベロープ:**

```mermaid
graph LR
    Start["無音<br/>0"] -->|Attack<br/>10ms| Peak["最大<br/>0.3"]
    Peak -->|Sustain<br/>継続| Sustain["維持<br/>0.3"]
    Sustain -->|Decay<br/>オプション| Decay["減衰"]
    Decay -->|Release<br/>100ms| Stop["停止<br/>0"]

    style Peak fill:#9f9
    style Sustain fill:#9f9
```

- **Attack**: 0 → 0.3 (10ms の線形ランプ)
- **Decay**: オプション機能で時間経過とともに減衰（減衰ON/OFFで切替可能）
- **Release**: 0.3 → 0 (100ms のフェードアウト)

---

## 3D 鍵盤レンダリング

### ExtrudeGeometry による立体鍵盤

```mermaid
graph TD
    Start["開始"] --> Outer["外周を描画<br/>(32セグメント)"]
    Outer --> Inner["内周を逆方向描画<br/>(32セグメント)"]
    Inner --> Close["パスを閉じる"]
    Close --> Extrude["ExtrudeGeometry<br/>厚み付与"]
    Extrude --> Bevel["ベベル処理<br/>エッジ丸め"]
    Bevel --> Mesh["Meshとして追加"]

    style Extrude fill:#e1f5ff
    style Bevel fill:#ffe1e1
    style Mesh fill:#9f9
```

```javascript
// ドーナツセグメントの形状作成
const keyShape = new THREE.Shape();

// 外周を描画（32セグメント)
for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const angle = startRad + (endRad - startRad) * t;
    const x = Math.cos(angle) * outerRadius;
    const y = Math.sin(angle) * outerRadius;
    if (i === 0) keyShape.moveTo(x, y);
    else keyShape.lineTo(x, y);
}

// 内周を逆方向で描画
for (let i = 32; i >= 0; i--) {
    const t = i / 32;
    const angle = startRad + (endRad - startRad) * t;
    const x = Math.cos(angle) * innerRadius;
    const y = Math.sin(angle) * innerRadius;
    keyShape.lineTo(x, y);
}

keyShape.closePath();

// 厚みを持たせる
const extrudeSettings = {
    depth: note.isBlack ? 0.03 : 0.02,  // 黒鍵は厚め
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 2
};

const keyGeometry = new THREE.ExtrudeGeometry(keyShape, extrudeSettings);
```

### エッジラインの描画

```mermaid
graph TD
    Geo["keyGeometry"] --> Edge["EdgesGeometry<br/>閾値15°"]
    Edge --> Line["LineBasicMaterial<br/>色: 白鍵=0x888888<br/>黒鍵=0x666666"]
    Line --> Seg["LineSegments"]
    Seg --> Add["keyMesh.add()"]

    style Edge fill:#e1f5ff
    style Add fill:#9f9
```

```javascript
// 重要なエッジのみ抽出 (15度以上の角度)
const edgeGeometry = new THREE.EdgesGeometry(keyGeometry, 15);
const edgeMaterial = new THREE.LineBasicMaterial({
    color: note.isBlack ? 0x666666 : 0x888888,
    linewidth: 2  // ※WebGL制限により常に1になる可能性あり
});
const edgeLine = new THREE.LineSegments(edgeGeometry, edgeMaterial);
keyMesh.add(edgeLine);  // 鍵盤の子要素として追加
```

### 押下アニメーション

```mermaid
flowchart LR
    Start([初期状態]) --> NotPressed[通常状態]
    NotPressed -->|isActive = true| Pressed[押下状態]
    Pressed -->|isActive = false| NotPressed

    NotPressed -.-> NP1["色: defaultColor<br/>発光: なし 0x000000<br/>Y位置: defaultY<br/>ラベルY: defaultLabelY"]

    Pressed -.-> P1["色: 黄色 0xffff00<br/>発光: オレンジ 0xff8800<br/>Y位置: pressedY<br/>ラベルY: pressedY + offset"]

    style NotPressed fill:#e1f5ff
    style Pressed fill:#ff9
```

```javascript
if (isActive) {
    // 押されている状態
    keyMesh.material.color.setHex(0xffff00);      // 黄色
    keyMesh.material.emissive.setHex(0xff8800);   // オレンジの発光
    keyMesh.position.y = pressedY;                // 下に移動

    // ラベルも鍵盤に追従
    const labelOffset = defaultLabelY - defaultY;
    label.position.y = pressedY + labelOffset;
} else {
    // デフォルトの状態に復帰
    keyMesh.material.color.setHex(defaultColor);
    keyMesh.material.emissive.setHex(0x000000);
    keyMesh.position.y = defaultY;
    label.position.y = defaultLabelY;
}
```

---

## WebSocket 通信と再接続

### 自動再接続メカニズム

```mermaid
flowchart TD
    Start([開始]) --> Connecting[WebSocket接続中]
    Connecting -->|成功| Connected[接続完了]
    Connecting -->|失敗| Disconnected{再接続試行<br/>回数チェック}
    Connected -->|切断/エラー| Disconnected

    Disconnected -->|1回目| Wait1[1秒待機]
    Disconnected -->|2回目| Wait2[2秒待機]
    Disconnected -->|3回目| Wait3[3秒待機]
    Disconnected -->|4回目| Wait4[4秒待機]
    Disconnected -->|5回目| Wait5[5秒待機]
    Disconnected -->|6回目以降| Reload[ページリロード]

    Wait1 --> Connecting
    Wait2 --> Connecting
    Wait3 --> Connecting
    Wait4 --> Connecting
    Wait5 --> Connecting

    Connected --> Ping[Ping送信<br/>1秒間隔]
    Ping -->|Pong受信| Connected
    Ping -->|3秒タイムアウト| Timeout[ws.close実行]
    Timeout --> Disconnected

    style Connected fill:#9f9
    style Disconnected fill:#ff9
    style Reload fill:#f66,color:#fff
    style Timeout fill:#faa
```

```javascript
const connectWebSocket = () => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
        reconnectAttemptsRef.current = 0;  // 成功したらカウンタリセット
        // Ping送信を開始
    };

    ws.onclose = () => {
        reconnectAttemptsRef.current++;

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            // 指数バックオフで再接続
            const delay = Math.min(1000 * reconnectAttemptsRef.current, 5000);
            setTimeout(() => connectWebSocket(), delay);
        } else {
            // 5回失敗したらページリロード
            window.location.reload();
        }
    };
};
```

**再接続ポリシー**:
1. 1回目の切断: 1秒後に再接続
2. 2回目の切断: 2秒後に再接続
3. 3回目の切断: 3秒後に再接続
4. 4回目の切断: 4秒後に再接続
5. 5回目の切断: 5秒後に再接続
6. それ以上失敗: ページを完全リロード

### Ping タイムアウト監視

```mermaid
sequenceDiagram
    participant Browser
    participant WebSocket
    participant ESP32

    loop 1秒間隔
        Browser->>WebSocket: Ping送信
        WebSocket->>ESP32: ping

        alt 3秒以内に応答
            ESP32->>WebSocket: pong
            WebSocket->>Browser: Pong受信
            Browser->>Browser: clearTimeout()
        else 3秒タイムアウト
            Browser->>Browser: Timeout検知
            Browser->>WebSocket: ws.close()
            WebSocket->>Browser: onclose イベント
            Browser->>Browser: 再接続処理
        end
    end
```

```javascript
// Ping送信 (1秒間隔)
setInterval(() => {
    ws.send(JSON.stringify({ type: 'ping', id: seq++, t: nowMs() }));

    // 3秒以内に応答がなければ切断
    pingTimeoutRef.current = setTimeout(() => {
        console.warn('Ping timeout - reconnecting...');
        ws.close();  // → onclose で再接続処理が起動
    }, 3000);
}, 1000);

// Pong受信時
ws.onmessage = (event) => {
    if (msg.type === 'ping') {
        clearTimeout(pingTimeoutRef.current);  // タイムアウトキャンセル
        // RTT計算と統計更新
    }
};
```

---

## 実行方法

### インストール

```bash
cd gui
npm install
```

### 開発サーバー起動

```bash
npm run dev
```

→ `http://localhost:****/` でアクセス

### 本番ビルド

```bash
npm run build
```

→ `dist/` ディレクトリに静的ファイルが生成されます


### 音声有効化

1. ブラウザでページを開く
2. **画面を一度クリック**（AudioContext のユーザージェスチャー要件）
3. 左上の「Audio: Enabled」を確認

---

## 実装の技術的詳細

### メモリ管理

```mermaid
graph TD
    Old["古い鍵盤メッシュ"] --> Geo["geometry.dispose()"]
    Old --> Mat["material.dispose()"]
    Old --> Rem["scene.remove()"]

    Geo --> GPU["GPU メモリ解放"]
    Mat --> GPU
    Rem --> Scene["シーンから削除"]

    GPU --> New["新しい鍵盤生成"]
    Scene --> New

    style Old fill:#faa
    style GPU fill:#9f9
    style New fill:#e1f5ff
```

```javascript
// 鍵盤を再生成する際の古いジオメトリの破棄
pianoKeysRef.current.forEach(key => {
    if (key.geometry) key.geometry.dispose();  // GPU メモリ解放
    if (key.material) key.material.dispose();
    scene.remove(key);
});
```

### パフォーマンス最適化

```mermaid
graph LR
    A["BufferGeometry<br/>再利用"] --> Perf[高パフォーマンス]
    B["needsUpdate<br/>フラグ"] --> Perf
    C["useCallback<br/>メモ化"] --> Perf

    A -.-> A1["毎フレーム生成せず<br/>属性更新のみ"]
    B -.-> B2["変更部分のみ<br/>GPU転送"]
    C -.-> C3["不要な再計算<br/>防止"]

    style Perf fill:#9f9
```

1. **BufferGeometry の再利用**: 毎フレーム新規作成せず、属性を更新
2. **needsUpdate フラグ**: 変更があった属性のみ GPU に転送
3. **useCallback**: 鍵盤生成関数をメモ化して不要な再計算を防止

```javascript
const createPianoKeys = useCallback(() => {
    // 鍵盤生成処理
}, []);  // 依存配列が空なので初回のみ生成
```

### ブラウザ互換性

```mermaid
graph TD
    subgraph "完全サポート"
        Chrome[Chrome ✅]
        Firefox[Firefox ✅]
        Safari[Safari ✅]
        Edge[Edge ✅]
    end

    Chrome --> Features
    Firefox --> Features
    Safari --> Features
    Edge --> Features

    Features["WebSocket<br/>Web Audio API<br/>Three.js<br/>TypedArray"]

    Safari -.制限.-> Limit["iOS Safari:<br/>ユーザージェスチャー<br/>必須"]

    style Features fill:#9f9
    style Limit fill:#ff9
```

---

## ライセンスとクレジット

### 使用ライブラリ

- **React** (MIT License)
- **Three.js** (MIT License)
- **Vite** (MIT License)

### 参考資料

- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Three.js Documentation](https://threejs.org/docs/)
- [Pure Intonation - Wikipedia](https://en.wikipedia.org/wiki/Just_intonation)