/**
 * Web Audio API を使用したピアノシンセサイザー
 */

export type WaveType = 'sine' | 'square' | 'sawtooth' | 'triangle';

/**
 * ピアノシンセサイザークラス
 * Web Audio API を使用して音声を生成
 */
export class PianoSynth {
    private audioContext: AudioContext | null = null;
    private oscillators: Map<string, OscillatorNode> = new Map();
    private gainNodes: Map<string, GainNode> = new Map();
    private noteStartTimes: Map<string, number> = new Map();
    private waveType: OscillatorType = 'sawtooth'; // デフォルトはノコギリ波
    private decayEnabled: boolean = true; // 減衰機能のON/OFF（デフォルト: ON）
    private decayTime: number = 2.0; // 減衰時間（秒）

    /**
     * AudioContext を初期化
     */
    init(): void {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    }

    /**
     * 波形タイプを設定
     * @param type - 波形タイプ ('sine' | 'square' | 'sawtooth' | 'triangle')
     */
    setWaveType(type: OscillatorType): void {
        this.waveType = type;
    }

    /**
     * 減衰機能のON/OFF設定
     * @param enabled - 有効にする場合 true
     */
    setDecayEnabled(enabled: boolean): void {
        this.decayEnabled = enabled;
    }

    /**
     * 減衰処理を更新（アニメーションループから呼ぶ）
     * 減衰機能が有効な場合、各音の音量を時間経過に応じて減少
     */
    updateDecay(): void {
        if (!this.decayEnabled || !this.audioContext) return;

        const currentTime = this.audioContext.currentTime;
        for (const [noteName, gainNode] of this.gainNodes.entries()) {
            const startTime = this.noteStartTimes.get(noteName);
            if (startTime) {
                const elapsed = currentTime - startTime;
                if (elapsed < this.decayTime) {
                    // 指数関数的に減衰（0.3から0.05まで）
                    const decay = 0.3 * Math.exp(-3 * elapsed / this.decayTime) + 0.05;
                    gainNode.gain.setValueAtTime(decay, currentTime);
                } else {
                    // 減衰時間を超えたら最小音量に
                    gainNode.gain.setValueAtTime(0.05, currentTime);
                }
            }
        }
    }

    /**
     * 音を再生
     * @param freq - 周波数 (Hz)
     * @param noteName - 音名（連打防止用のキー）
     */
    playNote(freq: number, noteName: string): void {
        this.init();

        // 既に鳴っている場合は何もしない（連打防止）
        if (this.oscillators.has(noteName)) {
            return;
        }

        const oscillator = this.audioContext!.createOscillator();
        const gainNode = this.audioContext!.createGain();

        oscillator.type = this.waveType; // 設定された波形を使用
        oscillator.frequency.setValueAtTime(freq, this.audioContext!.currentTime);

        gainNode.gain.setValueAtTime(0, this.audioContext!.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, this.audioContext!.currentTime + 0.01);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext!.destination);

        oscillator.start();

        this.oscillators.set(noteName, oscillator);
        this.gainNodes.set(noteName, gainNode);
        this.noteStartTimes.set(noteName, this.audioContext!.currentTime);
    }

    /**
     * 音を停止
     * @param noteName - 停止する音名
     */
    stopNote(noteName: string): void {
        const oscillator = this.oscillators.get(noteName);
        const gainNode = this.gainNodes.get(noteName);

        if (oscillator && gainNode) {
            gainNode.gain.linearRampToValueAtTime(0, this.audioContext!.currentTime + 0.1);
            oscillator.stop(this.audioContext!.currentTime + 0.1);
            this.oscillators.delete(noteName);
            this.gainNodes.delete(noteName);
            this.noteStartTimes.delete(noteName);
        }
    }

    /**
     * 全ての音を停止
     */
    stopAll(): void {
        for (const noteName of this.oscillators.keys()) {
            this.stopNote(noteName);
        }
    }
}
