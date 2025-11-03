/**
 * LiDARピアノアプリケーション用定数定義
 */

import type { PianoConfig, PianoRange, BaseNote } from '../types/lidar';

// ============ ピアノ設定 ============

/**
 * ピアノ形状設定
 */
export const PIANO_CONFIG: PianoConfig = {
    innerRadius: 1.0,      // 内径 (m)
    outerRadius: 1.3,      // 外径 (m)
    startAngle: 120,       // 開始角度 (度) min:-90
    endAngle: 240,         // 終了角度 (度) max:270
};

/**
 * 基本周波数 (C4)
 */
export const BASE_FREQ = 264; // C4 = 264 Hz

/**
 * 音域設定
 */
export const PIANO_RANGE: PianoRange = {
    startNote: 'C',        // 開始音名（オクターブ番号なし）
    startOctave: 3,        // 開始オクターブ
    endNote: 'B',          // 終了音名（オクターブ番号なし）
    endOctave: 3,          // 終了オクターブ
    rangeShift: 0,         // 音域シフト (-2〜+2 オクターブ)
};

/**
 * 基本音階定義（C4基準、1オクターブ分、純正律）
 */
export const BASE_NOTES: BaseNote[] = [
    { note: 'C', ratio: 1, name: 'ド', isBlack: false },           // 1/1
    { note: 'C#', ratio: 16 / 15, name: 'ド#', isBlack: true },    // 16/15
    { note: 'D', ratio: 9 / 8, name: 'レ', isBlack: false },       // 9/8
    { note: 'D#', ratio: 6 / 5, name: 'レ#', isBlack: true },      // 6/5
    { note: 'E', ratio: 5 / 4, name: 'ミ', isBlack: false },       // 5/4
    { note: 'F', ratio: 4 / 3, name: 'フ', isBlack: false },       // 4/3
    { note: 'F#', ratio: 45 / 32, name: 'フ#', isBlack: true },    // 45/32
    { note: 'G', ratio: 3 / 2, name: 'ソ', isBlack: false },       // 3/2
    { note: 'G#', ratio: 8 / 5, name: 'ソ#', isBlack: true },      // 8/5
    { note: 'A', ratio: 5 / 3, name: 'ラ', isBlack: false },       // 5/3
    { note: 'A#', ratio: 16 / 9, name: 'ラ#', isBlack: true },     // 16/9
    { note: 'B', ratio: 15 / 8, name: 'シ', isBlack: false },      // 15/8
];
