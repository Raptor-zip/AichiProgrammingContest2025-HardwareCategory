/**
 * LiDARビジュアライザー用の型定義
 */

import * as THREE from 'three';

// ============ 音階・ピアノ関連 ============

/**
 * 音階情報
 */
export interface Note {
    /** 音名 (例: "C4", "A#3") */
    note: string;
    /** 周波数 (Hz) */
    freq: number;
    /** 日本語表記 (例: "ド", "ラ#") */
    name: string;
    /** 黒鍵かどうか */
    isBlack: boolean;
}

/**
 * 基本音階定義（1オクターブ分）
 */
export interface BaseNote {
    /** 音名 (オクターブなし、例: "C", "A#") */
    note: string;
    /** 基準音に対する周波数比 (純正律) */
    ratio: number;
    /** 日本語表記 */
    name: string;
    /** 黒鍵かどうか */
    isBlack: boolean;
}

/**
 * ピアノ形状設定
 */
export interface PianoConfig {
    /** 内径 (m) */
    innerRadius: number;
    /** 外径 (m) */
    outerRadius: number;
    /** 開始角度 (度) */
    startAngle: number;
    /** 終了角度 (度) */
    endAngle: number;
}

/**
 * ピアノ音域設定
 */
export interface PianoRange {
    /** 開始音名 (オクターブ番号なし) */
    startNote: string;
    /** 開始オクターブ */
    startOctave: number;
    /** 終了音名 (オクターブ番号なし) */
    endNote: string;
    /** 終了オクターブ */
    endOctave: number;
    /** 音域シフト (-2〜+2 オクターブ) */
    rangeShift: number;
}

// ============ LiDAR データ関連 ============

/**
 * LiDAR フレームデータ (1スキャン分)
 */
export interface LiDARFrame {
    /** 距離データ配列 (360点) */
    distances: number[];
    /** フレーム受信タイムスタンプ (ms) */
    timestamp: number;
}

/**
 * WebSocket メッセージ型
 */
export type WebSocketMessage =
    | { type: 'ping' }
    | { type: 'pong' }
    | { type: 'lidar'; data: ArrayBuffer };

/**
 * 統計情報
 */
export interface Statistics {
    /** 受信データ数 */
    receivedCount: number;
    /** 処理済みデータ数 */
    processedCount: number;
    /** 平均レイテンシ (ms) */
    avgLatency: number;
    /** 最小レイテンシ (ms) */
    minLatency: number;
    /** 最大レイテンシ (ms) */
    maxLatency: number;
}

/**
 * ログエントリ
 */
export interface LogEntry {
    /** ログID */
    id: number;
    /** タイムスタンプ */
    timestamp: string;
    /** ログレベル */
    level: 'info' | 'warning' | 'error';
    /** ログメッセージ */
    message: string;
}

// ============ Three.js 関連 ============

/**
 * ピアノキーメッシュとラベルのペア
 */
export interface PianoKey {
    /** キーメッシュ */
    keyMesh: THREE.Mesh;
    /** ラベルメッシュ (PlaneGeometry) */
    labelMesh: THREE.Mesh;
    /** 音階情報 */
    note: Note;
    /** キー押下状態 */
    isPressed: boolean;
    /** 元の位置 (ワールド座標) */
    originalPosition: THREE.Vector3;
    /** 元のY座標 (ローカル) */
    originalY: number;
}

/**
 * Three.js シーンリソース
 */
export interface SceneResources {
    /** Three.js レンダラー */
    renderer: THREE.WebGLRenderer;
    /** シーン */
    scene: THREE.Scene;
    /** カメラ */
    camera: THREE.PerspectiveCamera;
    /** オービットコントロール */
    controls: any; // OrbitControls は型定義がないため any
    /** アニメーションフレームID */
    animationFrameId?: number;
}

/**
 * 点群データ (Three.js Points 用)
 */
export interface PointCloudData {
    /** 中心部の Points オブジェクト */
    pointsCore: THREE.Points;
    /** 外周部の Points オブジェクト */
    pointsOutline: THREE.Points;
    /** ジオメトリ */
    geometry: THREE.BufferGeometry;
    /** 位置属性配列 */
    positions: Float32Array;
    /** 色属性配列 */
    colors: Float32Array;
}

// ============ 定数エクスポート用の型 ============

/**
 * 設定値の型
 */
export interface Config {
    /** ピアノ形状設定 */
    PIANO_CONFIG: PianoConfig;
    /** ピアノ音域設定 */
    PIANO_RANGE: PianoRange;
    /** 基本周波数 (C4 = 264 Hz) */
    BASE_FREQ: number;
    /** 基本音階定義 */
    BASE_NOTES: BaseNote[];
}
