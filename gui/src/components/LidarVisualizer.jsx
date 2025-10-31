import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// 高精度タイムスタンプを返す
function nowMs() {
    if (window.performance && typeof performance.now === 'function' && typeof performance.timeOrigin === 'number') {
        return performance.timeOrigin + performance.now();
    }
    return Date.now();
}

// ピアノ設定
const PIANO_CONFIG = {
    innerRadius: 1.0,      // 内径 (m)
    outerRadius: 1.3,      // 外径 (m)
    startAngle: 50,        // 開始角度 (度) min:-90
    endAngle: 270,         // 終了角度 (度) max:270
};

// ピアノ音階定義 (純正律 - 整数比)
// C4 = 264 Hz (基準音を調整してキリの良い数値に)
const BASE_FREQ = 264; // C4

// 音域設定
const PIANO_RANGE = {
    startNote: 'C',    // 開始音名（オクターブ番号なし）
    startOctave: 3,    // 開始オクターブ
    endNote: 'B',      // 終了音名（オクターブ番号なし）
    endOctave: 4,      // 終了オクターブ
    rangeShift: 0,     // 音域シフト (-2〜+2 オクターブ)
};

// 基本音階定義（C4基準、1オクターブ分）
const BASE_NOTES = [
    { note: 'C', ratio: 1, name: 'ド', isBlack: false },  // 1/1
    { note: 'C#', ratio: 16 / 15, name: 'ド#', isBlack: true },   // 16/15
    { note: 'D', ratio: 9 / 8, name: 'レ', isBlack: false },  // 9/8
    { note: 'D#', ratio: 6 / 5, name: 'レ#', isBlack: true },   // 6/5
    { note: 'E', ratio: 5 / 4, name: 'ミ', isBlack: false },  // 5/4
    { note: 'F', ratio: 4 / 3, name: 'フ', isBlack: false },  // 4/3
    { note: 'F#', ratio: 45 / 32, name: 'フ#', isBlack: true },   // 45/32
    { note: 'G', ratio: 3 / 2, name: 'ソ', isBlack: false },  // 3/2
    { note: 'G#', ratio: 8 / 5, name: 'ソ#', isBlack: true },   // 8/5
    { note: 'A', ratio: 5 / 3, name: 'ラ', isBlack: false },  // 5/3
    { note: 'A#', ratio: 16 / 9, name: 'ラ#', isBlack: true },   // 16/9
    { note: 'B', ratio: 15 / 8, name: 'シ', isBlack: false },  // 15/8
];

// 音階範囲を生成する関数
function generatePianoNotes(startNote, startOctave, endNote, endOctave, rangeShift = 0) {
    const notes = [];
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

// 初期音階を生成
let PIANO_NOTES = generatePianoNotes(
    PIANO_RANGE.startNote,
    PIANO_RANGE.startOctave,
    PIANO_RANGE.endNote,
    PIANO_RANGE.endOctave,
    PIANO_RANGE.rangeShift
);

// Web Audio API用の音声生成
class PianoSynth {
    constructor() {
        this.audioContext = null;
        this.oscillators = new Map();
        this.gainNodes = new Map();
        this.waveType = 'sawtooth'; // デフォルトはノコギリ波
        this.decayEnabled = true; // 減衰機能のON/OFF（デフォルト: ON）
        this.decayTime = 2.0; // 減衰時間（秒）
        this.noteStartTimes = new Map(); // 各音の開始時刻
    }

    init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    setWaveType(type) {
        this.waveType = type;
    }

    setDecayEnabled(enabled) {
        this.decayEnabled = enabled;
    }

    updateDecay() {
        // 減衰機能が有効な場合、各音の音量を時間経過に応じて減少
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

    playNote(freq, noteName) {
        this.init();

        // 既に鳴っている場合は何もしない（連打防止）
        if (this.oscillators.has(noteName)) {
            return;
        }

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = this.waveType; // 設定された波形を使用
        oscillator.frequency.setValueAtTime(freq, this.audioContext.currentTime);

        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.01);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start();

        this.oscillators.set(noteName, oscillator);
        this.gainNodes.set(noteName, gainNode);
        this.noteStartTimes.set(noteName, this.audioContext.currentTime);
    }

    stopNote(noteName) {
        const oscillator = this.oscillators.get(noteName);
        const gainNode = this.gainNodes.get(noteName);

        if (oscillator && gainNode) {
            gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
            oscillator.stop(this.audioContext.currentTime + 0.1);
            this.oscillators.delete(noteName);
            this.gainNodes.delete(noteName);
            this.noteStartTimes.delete(noteName);
        }
    }

    stopAll() {
        for (const noteName of this.oscillators.keys()) {
            this.stopNote(noteName);
        }
    }
}

const LidarVisualizer = () => {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const rendererRef = useRef(null);
    const pointsRef = useRef(null);
    const animationIdRef = useRef(null);
    const wsRef = useRef(null);
    const pingTimerRef = useRef(null);
    const pingTimeoutRef = useRef(null); // Pingタイムアウト監視用
    const dataTimeoutRef = useRef(null); // データフレームタイムアウト監視用
    const lastDataReceivedRef = useRef(Date.now()); // 最後にデータを受信した時刻
    const pingSeqRef = useRef(0);
    const pingHistoryRef = useRef([]); // Ping履歴（直近30秒分） { timestamp: number, rtt: number }[]
    const synthRef = useRef(null);
    const pianoKeysRef = useRef([]); // ピアノ鍵盤のメッシュ配列
    const pianoEdgesRef = useRef([]); // ピアノ鍵盤の境界線配列
    const pianoLabelsRef = useRef([]); // ピアノ鍵盤の音名ラベル配列
    const centerTextRef = useRef(null); // 円の中心の演奏中テキスト
    const activeNotesRef = useRef(new Set()); // 現在鳴っている音
    const rangeShiftRef = useRef(PIANO_RANGE.rangeShift); // 音域シフトの現在値（ref版）
    const pianoNotesRef = useRef(PIANO_NOTES); // 現在の音階配列（ref版）
    // 可変パラメータ用のrefs
    const innerRadiusRef = useRef(PIANO_CONFIG.innerRadius);
    const outerRadiusRef = useRef(PIANO_CONFIG.outerRadius);
    const boundaryMarginRatioRef = useRef(0.2);
    // WebSocket再接続用
    const reconnectAttemptsRef = useRef(0); // 再接続試行回数
    const reconnectTimerRef = useRef(null); // 再接続タイマー
    const connectionCheckTimerRef = useRef(null); // 接続状態チェックタイマー
    const maxReconnectAttempts = 5; // 最大再接続試行回数（5回失敗したらリロード）
    const dataTimeoutDuration = 5000; // データ受信タイムアウト (5秒)

    // 円の中心のテキストを更新する関数
    const updateCenterText = (notes) => {
        if (!centerTextRef.current) return;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 1024;
        canvas.height = 512;

        // 透明背景
        context.fillStyle = 'rgba(0, 0, 0, 0)';
        context.fillRect(0, 0, 1024, 512);

        if (notes.length > 0) {
            // 演奏中の音を表示
            context.textAlign = 'center';
            context.textBaseline = 'middle';

            const noteNames = notes.map(n => n.note).join(', ');
            context.font = 'bold 50px Arial';
            context.shadowBlur = 10;
            context.shadowOffsetX = 3;
            context.shadowOffsetY = 3;
            context.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            context.lineWidth = 5;
            context.strokeText(noteNames, 512, 350);
            context.fillStyle = 'rgba(255, 255, 255, 0.9)';
            context.fillText(noteNames, 512, 350);
        }

        // テクスチャを更新
        const texture = new THREE.CanvasTexture(canvas);
        centerTextRef.current.material.map = texture;
        centerTextRef.current.material.needsUpdate = true;
    };

    const [wsStatus, setWsStatus] = useState('disconnected');
    const [frameCount, setFrameCount] = useState(0);
    const [fps, setFps] = useState(0);
    const [lastTimestamp, setLastTimestamp] = useState(0);
    const [pingEnabled, setPingEnabled] = useState(false);
    const [pingStats, setPingStats] = useState({ min: Infinity, max: -Infinity, avg: 0, count: 0 });
    const [lastRTT, setLastRTT] = useState(0);
    const [currentNotes, setCurrentNotes] = useState([]); // 現在踏んでいる音
    const [audioEnabled, setAudioEnabled] = useState(false); // オーディオ有効化状態
    const [rangeShift, setRangeShift] = useState(PIANO_RANGE.rangeShift); // 音域シフト (-2 ~ +2)
    const [waveType, setWaveType] = useState('sawtooth'); // 波形タイプ（デフォルト: ノコギリ波）
    const [decayEnabled, setDecayEnabled] = useState(true); // 音の減衰ON/OFF（デフォルト: ON）
    const [flipHorizontal, setFlipHorizontal] = useState(false); // 左右反転
    const [flipVertical, setFlipVertical] = useState(false); // 上下反転
    const [rotate180, setRotate180] = useState(false); // 180度回転
    // 可変な音検出レンジ（UIで変更可能にする）
    const [innerRadius, setInnerRadius] = useState(PIANO_CONFIG.innerRadius);
    const [outerRadius, setOuterRadius] = useState(PIANO_CONFIG.outerRadius);
    const [boundaryMarginRatio, setBoundaryMarginRatio] = useState(0.2);

    // 反転/回転フラグのref版（WebSocketハンドラのクロージャ問題を回避）
    const flipHorizontalRef = useRef(flipHorizontal);
    const flipVerticalRef = useRef(flipVertical);
    const rotate180Ref = useRef(rotate180);

    // state -> ref 同期
    useEffect(() => { flipHorizontalRef.current = flipHorizontal; }, [flipHorizontal]);
    useEffect(() => { flipVerticalRef.current = flipVertical; }, [flipVertical]);
    useEffect(() => { rotate180Ref.current = rotate180; }, [rotate180]);

    // 可変パラメータ state -> ref 同期
    useEffect(() => { innerRadiusRef.current = innerRadius; }, [innerRadius]);
    useEffect(() => { outerRadiusRef.current = outerRadius; }, [outerRadius]);
    useEffect(() => { boundaryMarginRatioRef.current = boundaryMarginRatio; }, [boundaryMarginRatio]);

    // ピアノ鍵盤を作成する関数（useCallbackでメモ化）
    const createPianoKeys = useCallback(() => {
        const scene = sceneRef.current;
        if (!scene) return;

        const { startAngle, endAngle } = PIANO_CONFIG;
        const innerR = innerRadiusRef.current;
        const outerR = outerRadiusRef.current;
        const angleRange = endAngle - startAngle;
        const currentNotes = pianoNotesRef.current;
        const degreesPerKey = angleRange / currentNotes.length;
        const keys = [];
        const edges = [];
        const labels = [];

        currentNotes.forEach((note, index) => {
            const startDeg = startAngle + (index * degreesPerKey);
            const endDeg = startDeg + degreesPerKey;

            // ラジアンに変換（-90度オフセット: LiDARの0度=前方）
            const startRad = ((startDeg - 90) * Math.PI) / 180;
            const endRad = ((endDeg - 90) * Math.PI) / 180;

            // 黒鍵は外側、白鍵は内側から外側まで
            const keyInnerRadius = note.isBlack ? (innerR + outerR) / 2 : innerR;
            const keyOuterRadius = outerR;

            // ドーナツセグメントの形状を作成
            const keyShape = new THREE.Shape();
            const segments = 32;

            // 外周
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                const x = Math.cos(angle) * keyOuterRadius;
                const y = Math.sin(angle) * keyOuterRadius;
                if (i === 0) {
                    keyShape.moveTo(x, y);
                } else {
                    keyShape.lineTo(x, y);
                }
            }

            // 内周（逆方向）
            for (let i = segments; i >= 0; i--) {
                const t = i / segments;
                const angle = startRad + (endRad - startRad) * t;
                const x = Math.cos(angle) * keyInnerRadius;
                const y = Math.sin(angle) * keyInnerRadius;
                keyShape.lineTo(x, y);
            }

            keyShape.closePath();

            // 厚みを持たせるためにExtrudeGeometryを使用
            const extrudeSettings = {
                depth: note.isBlack ? 0.03 : 0.02, // 黒鍵は厚め
                bevelEnabled: true,
                bevelThickness: 0.002,
                bevelSize: 0.002,
                bevelSegments: 2
            };
            const keyGeometry = new THREE.ExtrudeGeometry(keyShape, extrudeSettings);
            const keyMaterial = new THREE.MeshStandardMaterial({
                color: note.isBlack ? 0x333333 : 0xffffff,
                emissive: 0x000000,
                metalness: 0.1,
                roughness: 0.4
            });

            const keyMesh = new THREE.Mesh(keyGeometry, keyMaterial);
            keyMesh.rotation.x = -Math.PI / 2;
            keyMesh.position.y = note.isBlack ? 0.02 : 0.01; // 黒鍵を少し上に
            scene.add(keyMesh);
            keys.push(keyMesh);

            // 3D形状の鍵盤の境界線を追加（重要なエッジのみ）
            const edgeGeometry = new THREE.EdgesGeometry(keyGeometry, 15); // 15度以上のエッジのみ
            const edgeMaterial = new THREE.LineBasicMaterial({
                color: note.isBlack ? 0x666666 : 0x888888,
                linewidth: 2
            });
            const edgeLine = new THREE.LineSegments(edgeGeometry, edgeMaterial);
            keyMesh.add(edgeLine); // keyMeshの子要素として追加

            // 鍵盤に音名テキストを追加
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 512;
            canvas.height = 256;

            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.font = 'bold 120px Arial';

            // 影を追加
            context.shadowColor = 'rgba(0, 0, 0, 0.8)';
            context.shadowBlur = 10;
            context.shadowOffsetX = 4;
            context.shadowOffsetY = 4;

            // 縁（ストローク）を追加
            context.strokeStyle = note.isBlack ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.9)';
            context.lineWidth = 20;
            context.strokeText(note.note, 256, 128);

            // テキスト本体
            context.fillStyle = note.isBlack ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.9)';
            context.fillText(note.note, 256, 128);

            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
            const sprite = new THREE.Sprite(spriteMaterial);

            // スプライトの位置（鍵盤の中心）
            const midAngle = (startRad + endRad) / 2;
            const midRadius = (keyInnerRadius + keyOuterRadius) / 2;
            sprite.position.x = Math.cos(midAngle) * midRadius;
            sprite.position.y = note.isBlack ? 0.08 : 0.07;
            sprite.position.z = -Math.sin(midAngle) * midRadius;
            sprite.scale.set(0.2, 0.1, 1);

            scene.add(sprite);
            labels.push(sprite);
        });

        pianoKeysRef.current = keys;
        pianoEdgesRef.current = edges;
        pianoLabelsRef.current = labels;
    }, []);

    // 音域シフトが変更されたら音階を再生成
    useEffect(() => {
        rangeShiftRef.current = rangeShift;
        const newNotes = generatePianoNotes(
            PIANO_RANGE.startNote,
            PIANO_RANGE.startOctave,
            PIANO_RANGE.endNote,
            PIANO_RANGE.endOctave,
            rangeShift
        );
        pianoNotesRef.current = newNotes;
        PIANO_NOTES = newNotes; // グローバル変数も更新
        console.log(`Range shifted to ${rangeShift}: ${newNotes.length} notes, from ${newNotes[0].note} to ${newNotes[newNotes.length - 1].note}`);

        // 鍵盤を再描画（次のレンダリングサイクルで反映）
        if (sceneRef.current) {
            // 既存の鍵盤をクリア
            pianoKeysRef.current.forEach(key => {
                if (key.geometry) key.geometry.dispose();
                if (key.material) key.material.dispose();
                sceneRef.current.remove(key);
            });
            pianoEdgesRef.current.forEach(edge => {
                if (edge.geometry) edge.geometry.dispose();
                if (edge.material) edge.material.dispose();
                sceneRef.current.remove(edge);
            });
            pianoLabelsRef.current.forEach(label => {
                if (label.geometry) label.geometry.dispose();
                if (label.material) {
                    if (label.material.map) label.material.map.dispose();
                    label.material.dispose();
                }
                sceneRef.current.remove(label);
            });
            pianoKeysRef.current = [];
            pianoEdgesRef.current = [];
            pianoLabelsRef.current = [];

            // 鍵盤を再生成
            createPianoKeys();
        }
    }, [rangeShift, createPianoKeys]);

    // 半径が変更されたら鍵盤を再生成
    useEffect(() => {
        if (sceneRef.current) {
            // 既存の鍵盤をクリア
            pianoKeysRef.current.forEach(key => {
                if (key.geometry) key.geometry.dispose();
                if (key.material) key.material.dispose();
                sceneRef.current.remove(key);
            });
            pianoEdgesRef.current.forEach(edge => {
                if (edge.geometry) edge.geometry.dispose();
                if (edge.material) edge.material.dispose();
                sceneRef.current.remove(edge);
            });
            pianoLabelsRef.current.forEach(label => {
                if (label.geometry) label.geometry.dispose();
                if (label.material) {
                    if (label.material.map) label.material.map.dispose();
                    label.material.dispose();
                }
                sceneRef.current.remove(label);
            });
            pianoKeysRef.current = [];
            pianoEdgesRef.current = [];
            pianoLabelsRef.current = [];

            // 鍵盤を再生成
            createPianoKeys();
        }
    }, [innerRadius, outerRadius, createPianoKeys]);

    // 減衰機能のON/OFFをsynthに反映
    useEffect(() => {
        if (synthRef.current) {
            synthRef.current.setDecayEnabled(decayEnabled);
        }
    }, [decayEnabled]);

    // 演奏中の音が変わったら中央テキストを更新
    useEffect(() => {
        updateCenterText(currentNotes);
    }, [currentNotes]);

    // 画面クリックでオーディオコンテキストを開始
    const enableAudio = () => {
        if (synthRef.current && synthRef.current.audioContext) {
            synthRef.current.audioContext.resume().then(() => {
                console.log('AudioContext resumed');
                setAudioEnabled(true);
            });
        }
    };

    // WebSocket接続とバイナリデータ受信
    useEffect(() => {
        // PianoSynthを初期化
        if (!synthRef.current) {
            synthRef.current = new PianoSynth();
            console.log('PianoSynth initialized');
        }

        const h = window.location.hostname || '192.168.4.1';
        const url = `ws://${h}:81/`;

        // WebSocket切断時の共通処理
        const cleanupWebSocketTimers = () => {
            // すべてのタイマーをクリア
            if (pingTimerRef.current) {
                clearInterval(pingTimerRef.current);
                pingTimerRef.current = null;
            }
            if (pingTimeoutRef.current) {
                clearTimeout(pingTimeoutRef.current);
                pingTimeoutRef.current = null;
            }
            if (dataTimeoutRef.current) {
                clearInterval(dataTimeoutRef.current);
                dataTimeoutRef.current = null;
            }
            if (connectionCheckTimerRef.current) {
                clearInterval(connectionCheckTimerRef.current);
                connectionCheckTimerRef.current = null;
            }
        };

        // WebSocket強制切断（再接続トリガー）
        const forceReconnect = (reason) => {
            console.warn(`${reason}. Forcing reconnection...`);

            // すべての音を停止
            if (synthRef.current) {
                synthRef.current.stopAll();
            }
            activeNotesRef.current.clear();
            setCurrentNotes([]);

            // 状態を更新
            setWsStatus('disconnected');

            // タイマーをクリア
            cleanupWebSocketTimers();

            // WebSocketを閉じる（これがoncloseイベントをトリガー）
            if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED && wsRef.current.readyState !== WebSocket.CLOSING) {
                wsRef.current.close();
            }
        };

        // WebSocket接続関数
        const connectWebSocket = () => {
            console.log(`Connecting to WebSocket: ${url} (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
            setWsStatus('connecting');

            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('WebSocket connected');
                setWsStatus('connected');
                reconnectAttemptsRef.current = 0; // 接続成功したら再接続カウンタをリセット
                lastDataReceivedRef.current = Date.now(); // データ受信時刻を初期化

                // 接続後、自動的にPing送信開始（1秒間隔）
                pingSeqRef.current = 0;
                pingHistoryRef.current = []; // Ping履歴をクリア
                setPingStats({ min: Infinity, max: -Infinity, avg: 0, count: 0 });

                pingTimerRef.current = setInterval(() => {
                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        pingSeqRef.current++;
                        const payload = { type: 'ping', id: pingSeqRef.current, t: nowMs() };
                        wsRef.current.send(JSON.stringify(payload));

                        // 5秒以内にPong応答がない場合、再接続を試みる
                        if (pingTimeoutRef.current) {
                            clearTimeout(pingTimeoutRef.current);
                        }
                        pingTimeoutRef.current = setTimeout(() => {
                            forceReconnect('Ping timeout (5000ms) - No response from server');
                        }, 5000);
                    }
                }, 1000); // 1秒間隔でPing送信

                // データフレーム受信監視タイマー (5秒間データが来なかったら再接続)
                if (dataTimeoutRef.current) {
                    clearInterval(dataTimeoutRef.current);
                }
                dataTimeoutRef.current = setInterval(() => {
                    const now = Date.now();
                    const timeSinceLastData = now - lastDataReceivedRef.current;

                    if (timeSinceLastData > dataTimeoutDuration) {
                        forceReconnect(`No LiDAR data received for ${timeSinceLastData}ms`);
                    }
                }, 2000); // 2秒ごとにチェック

                // WebSocket接続状態の定期チェック (3秒ごと)
                if (connectionCheckTimerRef.current) {
                    clearInterval(connectionCheckTimerRef.current);
                }
                connectionCheckTimerRef.current = setInterval(() => {
                    if (wsRef.current) {
                        const state = wsRef.current.readyState;
                        if (state === WebSocket.CLOSING || state === WebSocket.CLOSED) {
                            forceReconnect('WebSocket state is CLOSING/CLOSED');
                        }
                    }
                }, 3000); // 3秒ごとにチェック

                setPingEnabled(true);
            };

            ws.onclose = (e) => {
                console.log('WebSocket closed:', e.code, e.reason);
                setWsStatus('disconnected');

                // タイマーをクリア
                cleanupWebSocketTimers();

                // すべての音を停止
                if (synthRef.current) {
                    synthRef.current.stopAll();
                }
                activeNotesRef.current.clear();
                setCurrentNotes([]);

                // 再接続を試みる
                reconnectAttemptsRef.current++;
                if (reconnectAttemptsRef.current < maxReconnectAttempts) {
                    const delay = Math.min(1000 * reconnectAttemptsRef.current, 5000); // 1秒、2秒、3秒、4秒、5秒...最大5秒
                    console.log(`Reconnecting in ${delay}ms... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
                    setWsStatus('connecting');
                    reconnectTimerRef.current = setTimeout(() => {
                        connectWebSocket();
                    }, delay);
                } else {
                    console.error(`Failed to reconnect after ${maxReconnectAttempts} attempts. Reloading page in 2 seconds...`);
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                }
            };

            ws.onerror = (e) => {
                console.error('WebSocket error:', e);
                setWsStatus('error');
            };

            let receivedFrames = 0;
            let lastFpsUpdate = Date.now();

            ws.onmessage = (event) => {
                // データ受信時刻を更新
                lastDataReceivedRef.current = Date.now();

                // バイナリデータ(LiDAR)の処理
                if (event.data instanceof ArrayBuffer) {
                    const buffer = new Uint8Array(event.data);

                    const type = buffer[0];
                    const pointCount = new Uint16Array(buffer.buffer, 2, 1)[0];
                    const timestamp = new Uint32Array(buffer.buffer, 4, 1)[0];

                    if (type !== 0x01 || pointCount !== 360) {
                        console.warn('Invalid LiDAR data format');
                        return;
                    }

                    const distances = new Float32Array(buffer.buffer, 8, pointCount);

                    // 変換を適用（回転・反転） - ref経由で最新値を読む
                    const transformedDistances = new Float32Array(360);
                    for (let i = 0; i < 360; i++) {
                        let transformedIndex = i;

                        // 180度回転
                        if (rotate180Ref.current) {
                            transformedIndex = (transformedIndex + 180) % 360;
                        }

                        // 左右反転（Y軸周りの反転 = X座標反転）
                        if (flipHorizontalRef.current) {
                            transformedIndex = (360 - transformedIndex) % 360;
                        }

                        // 上下反転（X軸周りの反転 = Z座標反転）
                        if (flipVerticalRef.current) {
                            transformedIndex = (180 - transformedIndex + 360) % 360;
                        }

                        transformedDistances[i] = distances[transformedIndex];
                    }

                    // 点群を更新
                    if (pointsRef.current) {
                        const positions = pointsRef.current.geometry.attributes.position.array;
                        const colors = pointsRef.current.geometry.attributes.color.array;
                        const startAngle = PIANO_CONFIG.startAngle;
                        const endAngle = PIANO_CONFIG.endAngle;
                        const innerR = innerRadiusRef.current;
                        const outerR = outerRadiusRef.current;

                        for (let i = 0; i < 360; i++) {
                            const angle = (i * Math.PI) / 180.0;
                            const distance = transformedDistances[i];

                            positions[i * 3] = -Math.cos(angle) * distance; // x軸を反転
                            positions[i * 3 + 1] = 0.1; // 鍵盤より上に配置
                            positions[i * 3 + 2] = Math.sin(angle) * distance;

                            // ドーナツ領域判定
                            const angleDeg = i - 90;
                            const isInDonutAngle = angleDeg >= startAngle && angleDeg <= endAngle;
                            const isInDonutRadius = distance >= innerR && distance <= outerR;
                            const isInDonut = isInDonutAngle && isInDonutRadius;

                            if (isInDonut) {
                                // ドーナツ領域内: 明るく目立つ色（黄色系）
                                colors[i * 3] = 1.0;     // R
                                colors[i * 3 + 1] = 1.0; // G
                                colors[i * 3 + 2] = 0.0; // B
                            } else {
                                // ドーナツ領域外: 暗く半透明（青灰色）
                                const normalizedDistance = Math.min(distance / 3.0, 1.0);
                                colors[i * 3] = normalizedDistance * 0.3;
                                colors[i * 3 + 1] = normalizedDistance * 0.3;
                                colors[i * 3 + 2] = normalizedDistance * 0.5;
                            }
                        }

                        pointsRef.current.geometry.attributes.position.needsUpdate = true;
                        pointsRef.current.geometry.attributes.color.needsUpdate = true;
                    }

                    // ピアノ鍵盤の足検出
                    const detectedNotes = [];
                    const startAngle = PIANO_CONFIG.startAngle;
                    const endAngle = PIANO_CONFIG.endAngle;
                    const innerR = innerRadiusRef.current;
                    const outerR = outerRadiusRef.current;
                    const currentPianoNotes = pianoNotesRef.current;
                    const angleRange = endAngle - startAngle;
                    const degreesPerKey = angleRange / currentPianoNotes.length;
                    const boundaryMarginRatio = boundaryMarginRatioRef.current; // 鍵盤の境界割合（左右各 margin/2 を除外）

                    for (let i = 0; i < 360; i++) {
                        const angleDeg = i - 90; // LiDARの0度を前方に調整
                        const distance = transformedDistances[i];

                        // ピアノの角度範囲内かチェック
                        if (angleDeg >= startAngle && angleDeg <= endAngle) {
                            // 距離がピアノの範囲内かチェック
                            if (distance >= innerR && distance <= outerR) {
                                // どの鍵盤か判定
                                const relativeAngle = angleDeg - startAngle;
                                const keyIndex = Math.floor(relativeAngle / degreesPerKey);

                                if (keyIndex >= 0 && keyIndex < currentPianoNotes.length) {
                                    // 鍵盤内の相対位置を計算（0.0〜1.0）
                                    const positionInKey = (relativeAngle - keyIndex * degreesPerKey) / degreesPerKey;

                                    // 境界マージンを除外（中央80%のみ有効）
                                    const margin = boundaryMarginRatio / 2;
                                    if (positionInKey >= margin && positionInKey <= (1.0 - margin)) {
                                        const note = currentPianoNotes[keyIndex];
                                        if (!detectedNotes.find(n => n.note === note.note)) {
                                            detectedNotes.push(note);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 音の再生・停止
                    if (synthRef.current) {
                        // 新しく検出された音を再生
                        detectedNotes.forEach(note => {
                            if (!activeNotesRef.current.has(note.note)) {
                                console.log(`Playing: ${note.note}, freq: ${note.freq.toFixed(2)}Hz`);
                                synthRef.current.playNote(note.freq, note.note);
                                activeNotesRef.current.add(note.note);
                            }
                        });

                        // 検出されなくなった音を停止
                        const detectedNoteNames = new Set(detectedNotes.map(n => n.note));
                        for (const noteName of activeNotesRef.current) {
                            if (!detectedNoteNames.has(noteName)) {
                                synthRef.current.stopNote(noteName);
                                activeNotesRef.current.delete(noteName);
                            }
                        }
                    }

                    // 鍵盤の色と位置を更新（3D効果）
                    pianoKeysRef.current.forEach((keyMesh, index) => {
                        const note = PIANO_NOTES[index];
                        const isActive = detectedNotes.some(n => n.note === note.note);

                        // デフォルトのY位置
                        const defaultY = note.isBlack ? 0.02 : 0.01;
                        const pressedY = note.isBlack ? -0.01 : -0.02; // 押されたときは下に移動
                        const defaultEdgeY = note.isBlack ? 0.021 : 0.011;
                        const pressedEdgeY = note.isBlack ? -0.009 : -0.019; // 境界線も一緒に移動

                        if (isActive) {
                            // 押されている状態
                            keyMesh.material.color.setHex(0xffff00); // 黄色（踏まれている）
                            keyMesh.material.emissive.setHex(0xff8800);
                            keyMesh.position.y = pressedY; // 下に移動

                            // 境界線も下に移動
                            if (pianoEdgesRef.current[index]) {
                                pianoEdgesRef.current[index].position.y = pressedEdgeY;
                            }
                            // ラベルも鍵盤に追従して下に移動
                            if (pianoLabelsRef.current[index]) {
                                const defaultLabelY = note.isBlack ? 0.08 : 0.07;
                                const labelOffset = defaultLabelY - defaultY; // ラベルと鍵盤の相対オフセット
                                pianoLabelsRef.current[index].position.y = pressedY + labelOffset;
                            }
                        } else {
                            // デフォルトの状態に戻す
                            if (note.isBlack) {
                                keyMesh.material.color.setHex(0x333333);
                                keyMesh.material.emissive.setHex(0x000000);
                            } else {
                                keyMesh.material.color.setHex(0xffffff);
                                keyMesh.material.emissive.setHex(0x000000);
                            }
                            keyMesh.position.y = defaultY; // 元の位置に戻す

                            // 境界線も元の位置に戻す
                            if (pianoEdgesRef.current[index]) {
                                pianoEdgesRef.current[index].position.y = defaultEdgeY;
                            }
                            // ラベルも元の位置に戻す
                            if (pianoLabelsRef.current[index]) {
                                const defaultLabelY = note.isBlack ? 0.08 : 0.07;
                                pianoLabelsRef.current[index].position.y = defaultLabelY;
                            }
                        }
                    });

                    setCurrentNotes(detectedNotes);

                    receivedFrames++;
                    setFrameCount(prev => prev + 1);
                    setLastTimestamp(timestamp);

                    const now = Date.now();
                    if (now - lastFpsUpdate >= 1000) {
                        setFps(receivedFrames);
                        receivedFrames = 0;
                        lastFpsUpdate = now;
                    }
                }
                // テキストデータ(Ping)の処理
                else if (typeof event.data === 'string') {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'ping') {
                            // Pong応答を受信したので、タイムアウトタイマーをクリア
                            if (pingTimeoutRef.current) {
                                clearTimeout(pingTimeoutRef.current);
                                pingTimeoutRef.current = null;
                            }

                            const now = nowMs();
                            const rtt = now - msg.t;
                            setLastRTT(rtt);

                            // Ping履歴に追加（タイムスタンプ付き）
                            pingHistoryRef.current.push({ timestamp: now, rtt });

                            // 30秒より古いデータを削除
                            const thirtySecondsAgo = now - 30000; // 30秒 = 30000ms
                            pingHistoryRef.current = pingHistoryRef.current.filter(
                                entry => entry.timestamp >= thirtySecondsAgo
                            );

                            // 直近30秒分の統計を計算
                            if (pingHistoryRef.current.length > 0) {
                                const rtts = pingHistoryRef.current.map(e => e.rtt);
                                const min = Math.min(...rtts);
                                const max = Math.max(...rtts);
                                const sum = rtts.reduce((acc, val) => acc + val, 0);
                                const avg = sum / rtts.length;
                                const count = rtts.length;

                                setPingStats({ min, max, avg, count });
                            }
                        }
                    } catch (e) {
                        console.warn('Invalid JSON from server', e);
                    }
                }
            };
        };

        // 初回接続を開始
        connectWebSocket();

        return () => {
            console.log('Cleaning up WebSocket and timers');

            // 再接続タイマーをクリア
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }

            // WebSocket関連タイマーをクリア
            cleanupWebSocketTimers();

            // WebSocketを閉じる
            if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
                wsRef.current.close();
            }

            // すべての音を停止
            if (synthRef.current) {
                synthRef.current.stopAll();
            }
        };
    }, []);

    useEffect(() => {
        if (!containerRef.current) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(
            75,
            containerRef.current.clientWidth / containerRef.current.clientHeight,
            0.1,
            1000
        );

        // 鍵盤の中央角度を計算（LiDARの0度=前方なので-90度オフセット）
        const centerAngle = (PIANO_CONFIG.startAngle + PIANO_CONFIG.endAngle) / 2.0 - 90;
        const centerAngleRad = (centerAngle * Math.PI) / 180; // 180度反転

        const cameraHeight = 1.5;
        const horizontalOffset = -1.5; // 手前側へのオフセット
        const lookAtDistance = 0.8; // 視点距離

        camera.position.set(
            -Math.cos(centerAngleRad) * horizontalOffset,
            cameraHeight,
            Math.sin(centerAngleRad) * horizontalOffset
        );

        camera.lookAt(
            -Math.cos(centerAngleRad) * lookAtDistance,
            0.0,
            Math.sin(centerAngleRad) * lookAtDistance
        );

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;

        controls.target.set(0.0, 0.0, 0.0);
        controls.update();

        // 初期鍵盤を作成
        createPianoKeys();

        // 照明を追加（MeshStandardMaterialのため）
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 5);
        scene.add(directionalLight);

        // 円の中心に演奏中の音を表示するテキストスプライト
        const centerCanvas = document.createElement('canvas');
        const centerContext = centerCanvas.getContext('2d');
        centerCanvas.width = 1024;
        centerCanvas.height = 512;

        // 初期テキスト（何も演奏していない状態）
        centerContext.fillStyle = 'rgba(0, 0, 0, 0)'; // 透明背景
        centerContext.fillRect(0, 0, 1024, 512);

        const centerTexture = new THREE.CanvasTexture(centerCanvas);
        const centerSpriteMaterial = new THREE.SpriteMaterial({
            map: centerTexture,
            transparent: true,
            depthTest: false, // 常に前面に表示
            depthWrite: false
        });
        const centerSprite = new THREE.Sprite(centerSpriteMaterial);
        centerSprite.position.set(0, 0.2, 0); // 円の中心、少し上
        centerSprite.scale.set(1.5, 0.75, 1); // サイズ調整
        scene.add(centerSprite);
        centerTextRef.current = centerSprite;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(360 * 3);
        const colors = new Float32Array(360 * 3);
        const alphas = new Float32Array(360); // 透明度用の配列

        for (let i = 0; i < 360; i++) {
            positions[i * 3] = 0.0;
            positions[i * 3 + 1] = 0.0;
            positions[i * 3 + 2] = 0.0;

            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.0;
            colors[i * 3 + 2] = 0.5;

            alphas[i] = 1.0; // 初期値は完全不透明
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

        const material = new THREE.PointsMaterial({
            size: 0.02,
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            opacity: 1.0
        });

        const points = new THREE.Points(geometry, material);
        scene.add(points);
        pointsRef.current = points;

        const animate = () => {
            animationIdRef.current = requestAnimationFrame(animate);
            controls.update();

            // 減衰機能が有効な場合、音量を更新
            if (synthRef.current) {
                synthRef.current.updateDecay();
            }

            renderer.render(scene, camera);
        };
        animate();

        const handleResize = () => {
            if (!containerRef.current) return;
            camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (animationIdRef.current) {
                cancelAnimationFrame(animationIdRef.current);
            }
            if (rendererRef.current && containerRef.current) {
                containerRef.current.removeChild(rendererRef.current.domElement);
            }
            geometry.dispose();
            material.dispose();
            renderer.dispose();
        };
    }, []);

    return (
        <div style={{ width: '100%', height: '100vh' }} onClick={enableAudio}>
            <div
                ref={containerRef}
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'relative'
                }}
            />

            {/* 中央上部: タイトル */}
            <div
                style={{
                    position: 'absolute',
                    top: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    textAlign: 'center',
                    pointerEvents: 'none'
                }}
            >
                <div style={{
                    fontSize: '100px',
                    fontWeight: 'bold',
                    fontFamily: 'serif',
                    background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 50%, #FF6347 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    textShadow: '0 0 20px rgba(255, 215, 0, 0.5)',
                    filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 15px rgba(255, 215, 0, 0.4))',
                    letterSpacing: '8px',
                    padding: '10px 20px'
                }}>
                    ピアノ
                </div>
                <div style={{
                    fontSize: '30px',
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontWeight: 'bold',
                    textShadow: '0 2px 4px rgba(0, 0, 0, 0.8)',
                    marginTop: '-10px',
                    letterSpacing: '4px'
                }}>
                    LiDAR FOOT PIANO
                </div>
            </div>

            {/* 左上: LiDAR情報 */}
            <div
                style={{
                    position: 'absolute',
                    top: 10,
                    left: 10,
                    color: 'white',
                    background: 'rgba(0, 0, 0, 0.7)',
                    padding: '10px',
                    borderRadius: '5px',
                    fontFamily: 'monospace',
                    fontSize: '14px'
                }}
            >
                <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
                    🎯 SonicRing
                </div>
                <div>WebSocket: <span style={{ color: wsStatus === 'connected' ? '#0f0' : '#f00' }}>{wsStatus}</span></div>
                <div>Points: 360 (1° resolution)</div>
                <div>Update Rate: {fps} Hz</div>
                <div>Frame Count: {frameCount}</div>
                <div>Timestamp: {lastTimestamp} ms</div>

                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '5px' }}>
                        📡 WebSocket Ping
                    </div>
                    <div>RTT: {lastRTT.toFixed(2)} ms</div>
                    <div>Min: {pingStats.min === Infinity ? '-' : pingStats.min.toFixed(2)} ms</div>
                    <div>Max: {pingStats.max === -Infinity ? '-' : pingStats.max.toFixed(2)} ms</div>
                    <div>Avg: {pingStats.count > 0 ? pingStats.avg.toFixed(2) : '-'} ms</div>
                    <div>Count: {pingStats.count}</div>
                </div>

                <div style={{ marginTop: '10px', fontSize: '12px', opacity: 0.8 }}>
                    Controls: Mouse to rotate, scroll to zoom
                </div>

                <div style={{
                    marginTop: '10px',
                    fontSize: '12px',
                    color: audioEnabled ? '#0f0' : '#ff0',
                    fontWeight: 'bold'
                }}>
                    🔊 Audio: {audioEnabled ? 'Enabled' : 'Click to enable'}
                </div>
            </div>

            {/* 右上: ピアノ設定 */}
            <div
                style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    color: 'white',
                    background: 'rgba(0, 0, 0, 0.7)',
                    padding: '10px',
                    borderRadius: '5px',
                    fontFamily: 'monospace',
                    fontSize: '12px'
                }}
            >
                <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
                    🎹 ピアノペダル設定
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div>内側半径: <strong>{innerRadius.toFixed(2)} m</strong></div>
                    <input
                        type="range"
                        min={0.1}
                        max={3.0}
                        step={0.01}
                        value={innerRadius}
                        onChange={(e) => {
                            e.stopPropagation();
                            const v = parseFloat(e.target.value);
                            // outer が内側より小さくならないように調整
                            const newOuter = Math.max(outerRadius, v + 0.01);
                            setInnerRadius(v);
                            setOuterRadius(newOuter);
                            innerRadiusRef.current = v;
                            outerRadiusRef.current = newOuter;
                        }}
                    />

                    <div>外側半径: <strong>{outerRadius.toFixed(2)} m</strong></div>
                    <input
                        type="range"
                        min={0.11}
                        max={4.0}
                        step={0.01}
                        value={outerRadius}
                        onChange={(e) => {
                            e.stopPropagation();
                            let v = parseFloat(e.target.value);
                            // outer が inner より必ず大きくなるように
                            if (v <= innerRadius) v = innerRadius + 0.01;
                            setOuterRadius(v);
                            outerRadiusRef.current = v;
                        }}
                    />

                    <div>開始角度: {PIANO_CONFIG.startAngle}°</div>
                    <div>終了角度: {PIANO_CONFIG.endAngle}°</div>


                    <div>鍵盤境界除外割合: <strong>{(boundaryMarginRatio * 100).toFixed(0)}%</strong></div>
                    <input
                        type="range"
                        min={0}
                        max={0.5}
                        step={0.01}
                        value={boundaryMarginRatio}
                        onChange={(e) => {
                            e.stopPropagation();
                            const v = parseFloat(e.target.value);
                            setBoundaryMarginRatio(v);
                            boundaryMarginRatioRef.current = v;
                        }}
                    />
                </div>
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                    鍵盤数: {PIANO_NOTES.length}
                </div>
                <div>演奏中: {currentNotes.length} 音</div>

                {/* 音域シフト */}
                <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255,255,255,0.3)'
                }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
                        🎹 音域シフト
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const newShift = Math.max(rangeShift - 1, -2);
                                setRangeShift(newShift);
                                // 既に鳴っている音を全て停止
                                if (synthRef.current) {
                                    synthRef.current.stopAll();
                                    activeNotesRef.current.clear();
                                }
                            }}
                            disabled={rangeShift <= -2}
                            style={{
                                padding: '8px 16px',
                                fontSize: '18px',
                                fontWeight: 'bold',
                                background: rangeShift <= -2 ? '#444' : '#cc6600',
                                color: 'white',
                                border: 'none',
                                borderRadius: '5px',
                                cursor: rangeShift <= -2 ? 'not-allowed' : 'pointer',
                                opacity: rangeShift <= -2 ? 0.5 : 1
                            }}
                        >
                            −
                        </button>
                        <div style={{
                            fontSize: '18px',
                            fontWeight: 'bold',
                            minWidth: '60px',
                            textAlign: 'center',
                            color: rangeShift === 0 ? '#0f0' : '#ffa500'
                        }}>
                            {rangeShift > 0 ? '+' : ''}{rangeShift}
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const newShift = Math.min(rangeShift + 1, 2);
                                setRangeShift(newShift);
                                // 既に鳴っている音を全て停止
                                if (synthRef.current) {
                                    synthRef.current.stopAll();
                                    activeNotesRef.current.clear();
                                }
                            }}
                            disabled={rangeShift >= 2}
                            style={{
                                padding: '8px 16px',
                                fontSize: '18px',
                                fontWeight: 'bold',
                                background: rangeShift >= 2 ? '#444' : '#cc6600',
                                color: 'white',
                                border: 'none',
                                borderRadius: '5px',
                                cursor: rangeShift >= 2 ? 'not-allowed' : 'pointer',
                                opacity: rangeShift >= 2 ? 0.5 : 1
                            }}
                        >
                            +
                        </button>
                    </div>
                    <div style={{ fontSize: '10px', marginTop: '5px', opacity: 0.7 }}>
                        範囲: {PIANO_RANGE.startNote}{PIANO_RANGE.startOctave + rangeShift} 〜 {PIANO_RANGE.endNote}{PIANO_RANGE.endOctave + rangeShift} ({pianoNotesRef.current.length}音)
                    </div>
                </div>

                {/* 波形選択 */}
                <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255,255,255,0.3)'
                }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
                        🎵 波形タイプ
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                        {['sine', 'triangle', 'sawtooth', 'square'].map(type => (
                            <button
                                key={type}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setWaveType(type);
                                    if (synthRef.current) {
                                        synthRef.current.setWaveType(type);
                                        // 既に鳴っている音を停止
                                        synthRef.current.stopAll();
                                        activeNotesRef.current.clear();
                                    }
                                }}
                                style={{
                                    padding: '6px 10px',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                    background: waveType === type ? '#00cc00' : '#0066cc',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    opacity: waveType === type ? 1 : 0.7
                                }}
                            >
                                {type === 'sine' ? 'サイン波' :
                                    type === 'triangle' ? '三角波' :
                                        type === 'sawtooth' ? 'ノコギリ波' :
                                            '矩形波'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 音の減衰 */}
                <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255,255,255,0.3)'
                }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
                        📉 音の減衰
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setDecayEnabled(!decayEnabled);
                        }}
                        style={{
                            padding: '8px 16px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            background: decayEnabled ? '#00cc00' : '#666666',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            width: '100%'
                        }}
                    >
                        {decayEnabled ? '✅ ON (時間経過で減衰)' : '❌ OFF (一定音量)'}
                    </button>
                </div>

                {/* 回転・反転コントロール */}
                <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255,255,255,0.3)'
                }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
                        🔄 回転・反転
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const v = !flipHorizontal;
                                setFlipHorizontal(v);
                                flipHorizontalRef.current = v;
                            }}
                            style={{
                                padding: '6px 10px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                background: flipHorizontal ? '#cc6600' : '#0066cc',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                opacity: flipHorizontal ? 1 : 0.7
                            }}
                        >
                            ↔️ 左右反転 {flipHorizontal ? 'ON' : 'OFF'}
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const v = !flipVertical;
                                setFlipVertical(v);
                                flipVerticalRef.current = v;
                            }}
                            style={{
                                padding: '6px 10px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                background: flipVertical ? '#cc6600' : '#0066cc',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                opacity: flipVertical ? 1 : 0.7
                            }}
                        >
                            ↕️ 上下反転 {flipVertical ? 'ON' : 'OFF'}
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const v = !rotate180;
                                setRotate180(v);
                                rotate180Ref.current = v;
                            }}
                            style={{
                                padding: '6px 10px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                background: rotate180 ? '#cc6600' : '#0066cc',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                opacity: rotate180 ? 1 : 0.7
                            }}
                        >
                            🔃 180°回転 {rotate180 ? 'ON' : 'OFF'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LidarVisualizer;
