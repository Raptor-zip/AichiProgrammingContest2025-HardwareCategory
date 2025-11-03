/**
 * ピアノ音階生成ユーティリティ
 */

import type { Note } from '../types/lidar';
import { BASE_FREQ, BASE_NOTES } from './constants';

/**
 * 音階範囲を生成する関数
 * @param startNote - 開始音名（オクターブ番号なし）
 * @param startOctave - 開始オクターブ
 * @param endNote - 終了音名（オクターブ番号なし）
 * @param endOctave - 終了オクターブ
 * @param rangeShift - 音域シフト (-2〜+2 オクターブ)
 * @returns 生成された音階配列
 */
export function generatePianoNotes(
    startNote: string,
    startOctave: number,
    endNote: string,
    endOctave: number,
    rangeShift: number = 0
): Note[] {
    const notes: Note[] = [];
    const startIdx = BASE_NOTES.findIndex(n => n.note === startNote);
    const endIdx = BASE_NOTES.findIndex(n => n.note === endNote);

    if (startIdx === -1 || endIdx === -1) {
        console.error('Invalid note names');
        return notes;
    }

    // シフトを適用
    const shiftedStartOctave = startOctave + rangeShift;
    const shiftedEndOctave = endOctave + rangeShift;

    // 開始オクターブから終了オクターブまで生成
    for (let octave = shiftedStartOctave; octave <= shiftedEndOctave; octave++) {
        const octaveDiff = octave - 4; // C4を基準とした差分
        const octaveMultiplier = Math.pow(2, octaveDiff);

        for (let i = 0; i < BASE_NOTES.length; i++) {
            // 範囲チェック
            if (octave === shiftedStartOctave && i < startIdx) continue;
            if (octave === shiftedEndOctave && i > endIdx) break;

            const baseNote = BASE_NOTES[i];
            notes.push({
                note: `${baseNote.note}${octave}`,
                freq: BASE_FREQ * baseNote.ratio * octaveMultiplier,
                name: baseNote.name,
                isBlack: baseNote.isBlack,
            });
        }
    }

    return notes;
}

/**
 * 高精度タイムスタンプを返す
 * @returns タイムスタンプ (ms)
 */
export function nowMs(): number {
    if (window.performance && typeof performance.now === 'function' && typeof performance.timeOrigin === 'number') {
        return performance.timeOrigin + performance.now();
    }
    return Date.now();
}
