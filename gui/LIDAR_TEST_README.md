# LiDAR Point Cloud Visualization Test

Three.jsを使用した4000点のLiDAR点群リアルタイム可視化テスト(10Hz更新)

## 機能

- **点数**: 4000点
- **更新頻度**: 10Hz (100msごと)
- **可視化**: Three.jsを使用した3D点群表示
- **色付け**: 距離に基づいた動的な色付け
- **インタラクション**: マウスで回転・ズーム可能

## テストの実行方法

```bash
cd gui
npm install
npm run lidar-test
```

ブラウザで `http://localhost:5173/lidar-test.html` を開く

## 操作方法

- **回転**: マウスドラッグ
- **ズーム**: マウスホイール
- **パン**: 右クリック + ドラッグ

## パフォーマンス確認

ブラウザのコンソールに以下の情報が表示されます:
- Update Rate: 10Hz (点群の更新頻度)
- Render FPS: レンダリングのフレームレート

## 実装詳細

### LidarVisualizer.jsx

- `THREE.Points`を使用して4000点を効率的に描画
- `BufferGeometry`と`BufferAttribute`で高速な頂点更新
- 10Hzのインターバルで点群位置と色を更新
- 円形スキャンパターンをシミュレート
- OrbitControlsで直感的な3Dナビゲーション

### パフォーマンス最適化

- `BufferAttribute.needsUpdate`フラグを使用した効率的な更新
- `PointsMaterial`のサイズと色の最適化
- レンダリングループと更新ループの分離

## カスタマイズ

点数を変更する場合は、`LidarVisualizer.jsx`内の以下の値を変更:

```javascript
const positions = new Float32Array(4000 * 3); // 点数を変更
const colors = new Float32Array(4000 * 3);
```

更新頻度を変更する場合:

```javascript
}, 100); // 100ms = 10Hz, 50ms = 20Hz など
```
