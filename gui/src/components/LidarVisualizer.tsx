// @ts-nocheck
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// 型定義のインポート
import type { Note } from '../types/lidar';

// ユーティリティのインポート
import { PIANO_CONFIG, PIANO_RANGE } from '../utils/constants';
import { generatePianoNotes, nowMs } from '../utils/piano';
import { PianoSynth } from '../utils/PianoSynth';

// 初期音階を生成
let PIANO_NOTES = generatePianoNotes(
    PIANO_RANGE.startNote,
    PIANO_RANGE.startOctave,
    PIANO_RANGE.endNote,
    PIANO_RANGE.endOctave,
    PIANO_RANGE.rangeShift
);

const LidarVisualizer = () => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    // wrapperRef: root div that contains UI + containerRef; use this for fullscreen so UI stays visible
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const pointsRef = useRef<THREE.Points | null>(null);
    const animationIdRef = useRef<number | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const pingTimerRef = useRef<number | null>(null);
    const pingTimeoutRef = useRef<number | null>(null); // Pingタイムアウト監視用
    const dataTimeoutRef = useRef<number | null>(null); // データフレームタイムアウト監視用
    const lastDataReceivedRef = useRef(Date.now()); // 最後にデータを受信した時刻
    const pingSeqRef = useRef(0);
    const pingHistoryRef = useRef<Array<{ timestamp: number; rtt: number }>>([]); // Ping履歴（直近30秒分）
    const synthRef = useRef<PianoSynth | null>(null);
    const pianoKeysRef = useRef<THREE.Mesh[]>([]); // ピアノ鍵盤のメッシュ配列
    const pianoEdgesRef = useRef<THREE.LineSegments[]>([]); // ピアノ鍵盤の境界線配列
    const pianoLabelsRef = useRef<THREE.Mesh[]>([]); // ピアノ鍵盤の音名ラベル配列
    const centerTextRef = useRef<THREE.Sprite | null>(null); // 円の中心の演奏中テキスト
    const activeNotesRef = useRef(new Set<string>()); // 現在鳴っている音
    const rangeShiftRef = useRef(PIANO_RANGE.rangeShift); // 音域シフトの現在値（ref版）
    const pianoNotesRef = useRef<Note[]>(PIANO_NOTES); // 現在の音階配列（ref版）
    // 可変パラメータ用のrefs
    const innerRadiusRef = useRef(PIANO_CONFIG.innerRadius);
    const outerRadiusRef = useRef(PIANO_CONFIG.outerRadius);
    const boundaryMarginRatioRef = useRef(0.2);
    const pointHeightRef = useRef(0.07);
    // WebSocket再接続用
    const reconnectAttemptsRef = useRef(0); // 再接続試行回数
    const reconnectTimerRef = useRef<number | null>(null); // 再接続タイマー
    const connectionCheckTimerRef = useRef<number | null>(null); // 接続状態チェックタイマー
    const maxReconnectAttempts = 5; // 最大再接続試行回数（5回失敗したらリロード）
    const dataTimeoutDuration = 5000; // データ受信タイムアウト (5秒)

    // 円の中心のテキストを更新する関数
    const updateCenterText = (notes: Note[]) => {
        if (!centerTextRef.current) return;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;
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
            context.font = 'bold 80px Arial';
            context.shadowBlur = 10;
            context.shadowOffsetX = 3;
            context.shadowOffsetY = 3;
            context.strokeStyle = 'rgba(0, 0, 0, 1)';
            context.lineWidth = 30;
            context.strokeText(noteNames, 512, 350);
            context.fillStyle = 'rgba(255, 255, 255, 0.9)';
            context.fillText(noteNames, 512, 350);
        }

        // テクスチャを更新
        const texture = new THREE.CanvasTexture(canvas);
        if (centerTextRef.current.material instanceof THREE.SpriteMaterial) {
            centerTextRef.current.material.map = texture;
            centerTextRef.current.material.needsUpdate = true;
        }
    };

    const [wsStatus, setWsStatus] = useState<string>('disconnected');
    const [frameCount, setFrameCount] = useState<number>(0);
    const [fps, setFps] = useState<number>(0);
    const [lastTimestamp, setLastTimestamp] = useState<number>(0);
    const [pingStats, setPingStats] = useState<{ min: number; max: number; avg: number; count: number }>({ min: Infinity, max: -Infinity, avg: 0, count: 0 });
    const [lastRTT, setLastRTT] = useState<number>(0);
    const [currentNotes, setCurrentNotes] = useState<Note[]>([]); // 現在踏んでいる音
    const [audioEnabled, setAudioEnabled] = useState<boolean>(false); // オーディオ有効化状態
    const [rangeShift, setRangeShift] = useState<number>(PIANO_RANGE.rangeShift); // 音域シフト (-2 ~ +2)
    const [waveType, setWaveType] = useState<OscillatorType>('sawtooth'); // 波形タイプ（デフォルト: ノコギリ波）
    const [decayEnabled, setDecayEnabled] = useState<boolean>(true); // 音の減衰ON/OFF（デフォルト: ON）
    const [flipHorizontal, setFlipHorizontal] = useState<boolean>(false); // 左右反転
    const [flipVertical, setFlipVertical] = useState<boolean>(false); // 上下反転
    const [rotate180, setRotate180] = useState<boolean>(false); // 180度回転
    const [innerRadius, setInnerRadius] = useState(PIANO_CONFIG.innerRadius);
    const [outerRadius, setOuterRadius] = useState(PIANO_CONFIG.outerRadius);
    const [boundaryMarginRatio, setBoundaryMarginRatio] = useState(0.2);
    const [startAngle, setStartAngle] = useState<number>(PIANO_CONFIG.startAngle);
    const [endAngle, setEndAngle] = useState<number>(PIANO_CONFIG.endAngle);
    const [mobilePanelsVisible, setMobilePanelsVisible] = useState<boolean>(false);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

    // 反転/回転フラグのref版（WebSocketハンドラのクロージャ問題を回避）
    const flipHorizontalRef = useRef(flipHorizontal);
    const flipVerticalRef = useRef(flipVertical);
    const rotate180Ref = useRef(rotate180);
    const startAngleRef = useRef<number>(startAngle);
    const endAngleRef = useRef<number>(endAngle);

    // state -> ref 同期
    useEffect(() => { flipHorizontalRef.current = flipHorizontal; }, [flipHorizontal]);
    useEffect(() => { flipVerticalRef.current = flipVertical; }, [flipVertical]);
    useEffect(() => { rotate180Ref.current = rotate180; }, [rotate180]);

    // 可変パラメータ state -> ref 同期
    useEffect(() => { innerRadiusRef.current = innerRadius; }, [innerRadius]);
    useEffect(() => { outerRadiusRef.current = outerRadius; }, [outerRadius]);
    useEffect(() => { boundaryMarginRatioRef.current = boundaryMarginRatio; }, [boundaryMarginRatio]);
    useEffect(() => { startAngleRef.current = startAngle; endAngleRef.current = endAngle; }, [startAngle, endAngle]);

    // ピアノ鍵盤を作成する関数（useCallbackでメモ化）
    const createPianoKeys = useCallback(() => {
        const scene = sceneRef.current;
        if (!scene) return;
        const startAngle = startAngleRef.current;
        const endAngle = endAngleRef.current;
        const innerR = innerRadiusRef.current;
        const outerR = outerRadiusRef.current;
        const angleRange = endAngle - startAngle;
        const currentNotes = pianoNotesRef.current;
        const degreesPerKey = angleRange / currentNotes.length;
        const keys: THREE.Mesh[] = [];
        const edges: THREE.LineSegments[] = [];
        const labels: THREE.Mesh[] = [];

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

            if (context) {
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
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            // テクスチャを中心回転させることで、メッシュを回転させずに文字の向きを調整できる
            texture.center.set(0.5, 0.5);
            texture.rotation = Math.PI; // 180度回転（上下反転・向き揃え）
            texture.needsUpdate = true;

            // 平面ジオメトリでラベルを作り、鍵盤の上面に貼り付ける（子要素として追加）
            const planeW = 0.2;
            const planeH = 0.1;
            const planeGeo = new THREE.PlaneGeometry(planeW, planeH);
            const planeMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide });
            const labelMesh = new THREE.Mesh(planeGeo, planeMat);

            // 鍵盤の中心位置（ワールド座標） — X/Z は鍵盤中心、Y は鍵盤の上面に合わせる
            const midAngle = (startRad + endRad) / 2;
            const midRadius = (keyInnerRadius + keyOuterRadius) / 2;
            const worldX = Math.cos(midAngle) * midRadius;
            const worldZ = -Math.sin(midAngle) * midRadius;

            // 鍵盤メッシュのワールド上の上面 (bounding box の max.y) を取得してラベル高さを合わせる
            const bbox = new THREE.Box3().setFromObject(keyMesh);
            const worldTopY = bbox.max.y !== -Infinity ? bbox.max.y : (note.isBlack ? 0.08 : 0.07);
            // わずかな Z-Fighting回避のため少しだけ上げる
            const worldPos = new THREE.Vector3(worldX, worldTopY + 0.001, worldZ);

            // 親を keyMesh にしてローカル座標に変換（貼り付ける）
            keyMesh.add(labelMesh);
            // worldPos はワールド座標上の鍵盤上面近傍の位置を示すので、
            // worldToLocal の変換結果をそのままローカル位置として使う。
            // 親が回転していても worldToLocal が正しいローカル座標を返すため
            // 手動で y を上書きしないことが重要。
            const localPos = keyMesh.worldToLocal(worldPos.clone());
            labelMesh.position.copy(localPos);
            // 子オブジェクトは親に合わせた向きになる（ローカル回転0でOK）
            // メッシュ自体は回転させず、テクスチャ回転で向きを調整しているためローカル回転は0にする
            labelMesh.rotation.set(0, 0, 0);
            // レンダリング順序と深度書き込みを制御して、点群がラベルの上に常に描画されるようにする
            labelMesh.renderOrder = 0;
            labelMesh.scale.set(1, 1, 1);

            // 保存しておく（後で掃除や参照のため）。userData にはローカル座標の y を保存して
            // 鍵盤移動（踏み込み）時にラベルが正しく追従するようにする。
            labelMesh.userData = { labelOffset: localPos.y };
            labels.push(labelMesh);
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

    // 開始角度・終了角度が変更されたら鍵盤を再生成
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
    }, [startAngle, endAngle, createPianoKeys]);

    // 減衰機能のON/OFFをsynthに反映
    useEffect(() => {
        if (synthRef.current) {
            synthRef.current.setDecayEnabled(decayEnabled);
        }
    }, [decayEnabled]);

    // フルスクリーン状態の同期
    useEffect(() => {
        const onFsChange = () => {
            setIsFullscreen(Boolean(document.fullscreenElement));
        };
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    // 演奏中の音が変わったら中央テキストを更新
    useEffect(() => {
        updateCenterText(currentNotes);
    }, [currentNotes]);

    // 画面クリックでオーディオコンテキストを開始
    const enableAudio = () => {
        if (synthRef.current) {
            synthRef.current.init();
            setAudioEnabled(true);
        }
    };

    // WebSocket接続とバイナリデータ受信
    useEffect(() => {
        // PianoSynthを初期化
        if (!synthRef.current) {
            synthRef.current = new PianoSynth();
            console.log('PianoSynth initialized');
        }

        const h = "esp32.local";
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

        // 再接続をスケジュールする（指数バックオフに近い挙動 + 小さなジッタ）
        const scheduleReconnect = (reason: string) => {
            console.warn(`Scheduling reconnect: ${reason}`);

            // 既に再接続タイマーがある場合は上書きしない
            if (reconnectTimerRef.current) return;

            reconnectAttemptsRef.current++;
            if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
                console.error(`Failed to reconnect after ${reconnectAttemptsRef.current} attempts. Giving up.`);
                setWsStatus('disconnected');
                // 最終手段としてページをリロードする前に少し待つ
                setTimeout(() => window.location.reload(), 2000);
                return;
            }

            // 緩やかなバックオフ: 1s,2s,3s... capped to 5s + small jitter
            const baseDelay = Math.min(1000 * reconnectAttemptsRef.current, 5000);
            const jitter = Math.floor(Math.random() * 400); // 0-399ms
            const delay = baseDelay + jitter;

            console.log(`Reconnecting in ${delay}ms... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
            setWsStatus('connecting');
            reconnectTimerRef.current = window.setTimeout(() => {
                reconnectTimerRef.current = null;
                connectWebSocket();
            }, delay);
        };

        // WebSocket強制切断（再接続トリガー）
        const forceReconnect = (reason: string) => {
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

            // WebSocket が存在する場合は適切に切断またはデタッチする
            if (wsRef.current) {
                try {
                    const state = wsRef.current.readyState;
                    if (state === WebSocket.OPEN) {
                        // close() を呼んで onclose の処理に委ねる
                        wsRef.current.close();
                    } else if (state === WebSocket.CONNECTING) {
                        // CONNECTING の場合、ブラウザでは close() が "closed before the connection is established" を出すことがあるため
                        // イベントハンドラを外して参照を切る（onclose を待たずに再接続スケジュール）
                        try { wsRef.current.onopen = null; } catch (e) { }
                        try { wsRef.current.onmessage = null; } catch (e) { }
                        try { wsRef.current.onclose = null; } catch (e) { }
                        try { wsRef.current.onerror = null; } catch (e) { }
                        wsRef.current = null;
                        // 直接再接続をスケジュール
                        scheduleReconnect(reason + ' (detached CONNECTING socket)');
                        return;
                    } else {
                        // CLOSING/CLOSED の場合は参照を切る
                        wsRef.current = null;
                    }
                } catch (e) {
                    console.warn('Error while forcing websocket reconnect cleanup', e);
                    wsRef.current = null;
                }
            }

            // 上記で close() を呼んだ場合、onclose 側で scheduleReconnect を行う。ただし念のためここでもスケジュールされていなければスケジュールする
            if (!reconnectTimerRef.current) {
                scheduleReconnect(reason + ' (after close)');
            }
        };

        // WebSocket接続関数
        const connectWebSocket = () => {
            // 既に別の接続が進行中/確立されている場合は重複を避ける
            if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
                console.log('connectWebSocket: socket already open or connecting, skipping new connect');
                return;
            }

            console.log(`Connecting to WebSocket: ${url} (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
            setWsStatus('connecting');

            let ws: WebSocket | null = null;
            try {
                ws = new WebSocket(url);
                ws.binaryType = 'arraybuffer';
                wsRef.current = ws;
            } catch (err) {
                console.error('connectWebSocket: WebSocket constructor failed', err);
                scheduleReconnect('WebSocket constructor failed');
                return;
            }

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

                // ソケット参照を切る（もし同一なら）
                if (wsRef.current === ws) wsRef.current = null;

                // 再接続をスケジュール（重複を避ける）
                if (!reconnectTimerRef.current) {
                    scheduleReconnect('onclose event');
                }
            };

            ws.onerror = (e) => {
                console.error('WebSocket error event:', e, 'socket readyState:', ws && ws.readyState, 'ref readyState:', wsRef.current && wsRef.current.readyState);
                setWsStatus('error');
                // エラー発生時は安全に強制再接続処理へ
                try {
                    forceReconnect('WebSocket error event');
                } catch (err) {
                    console.warn('forceReconnect failed inside onerror:', err);
                    if (!reconnectTimerRef.current) scheduleReconnect('onerror fallback');
                }
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
                        const startAngle = startAngleRef.current;
                        const endAngle = endAngleRef.current;
                        const innerR = innerRadiusRef.current;
                        const outerR = outerRadiusRef.current;

                        // ラベルのワールドYを取得しておく（鍵盤の踏み込みに追従する目的）
                        const currentPianoNotes = pianoNotesRef.current;
                        const angleRange = endAngle - startAngle;
                        const degreesPerKey = currentPianoNotes.length > 0 ? angleRange / currentPianoNotes.length : 360;
                        const labelWorldYs: number[] = [];
                        const _tmpVec = new THREE.Vector3();
                        if (pianoLabelsRef.current && pianoLabelsRef.current.length > 0) {
                            pianoLabelsRef.current.forEach((lbl, idx) => {
                                if (!lbl) {
                                    labelWorldYs[idx] = -Infinity;
                                    return;
                                }
                                // getWorldPosition はメッシュの現在のワールド座標を返す
                                lbl.getWorldPosition(_tmpVec);
                                labelWorldYs[idx] = _tmpVec.y;
                            });
                        }

                        for (let i = 0; i < 360; i++) {
                            const angle = (i * Math.PI) / 180.0;
                            const distance = transformedDistances[i];

                            positions[i * 3] = -Math.cos(angle) * distance; // x軸を反転

                            // デフォルトのY位置
                            let yPos = pointHeightRef.current;

                            // この点が鍵盤ドーナツ領域上にあるかをチェックし、該当鍵があれば鍵盤（ラベル）上面より上に出す
                            const angleDeg = i - 90;
                            const isInDonutAngle = angleDeg >= startAngle && angleDeg <= endAngle;
                            const isInDonutRadius = distance >= innerR && distance <= outerR;
                            if (isInDonutAngle && isInDonutRadius && degreesPerKey > 0) {
                                const relativeAngle = angleDeg - startAngle;
                                const keyIndex = Math.floor(relativeAngle / degreesPerKey);
                                if (keyIndex >= 0 && keyIndex < labelWorldYs.length) {
                                    const labelWorldY = labelWorldYs[keyIndex];
                                    if (labelWorldY !== -Infinity) {
                                        // ラベルのワールドYより少し上にして表示（Z-fighting回避）
                                        yPos = Math.max(pointHeightRef.current, labelWorldY + 0.002);
                                    }
                                }
                            }

                            positions[i * 3 + 1] = yPos;
                            positions[i * 3 + 2] = Math.sin(angle) * distance;

                            // カラーは従来通りドーナツ判定で分ける
                            if (isInDonutAngle && isInDonutRadius) {
                                colors[i * 3] = 0.0;
                                colors[i * 3 + 1] = 0.0;
                                colors[i * 3 + 2] = 1.0;
                            } else {
                                colors[i * 3] = 0.3;
                                colors[i * 3 + 1] = 0.3;
                                colors[i * 3 + 2] = 0.3;
                            }
                        }

                        pointsRef.current.geometry.attributes.position.needsUpdate = true;
                        pointsRef.current.geometry.attributes.color.needsUpdate = true;
                    }

                    // ピアノ鍵盤の足検出
                    const detectedNotes: Note[] = [];
                    const startAngle = startAngleRef.current;
                    const endAngle = endAngleRef.current;
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
                            const mat = keyMesh.material as THREE.MeshStandardMaterial;
                            mat.color.setHex(0xffff00); // 黄色（踏まれている）
                            mat.emissive.setHex(0xff8800);
                            keyMesh.position.y = pressedY; // 下に移動

                            // 境界線も下に移動
                            if (pianoEdgesRef.current[index]) {
                                pianoEdgesRef.current[index].position.y = pressedEdgeY;
                            }
                        } else {
                            // デフォルトの状態に戻す
                            const mat = keyMesh.material as THREE.MeshStandardMaterial;
                            if (note.isBlack) {
                                mat.color.setHex(0x333333);
                                mat.emissive.setHex(0x000000);
                            } else {
                                mat.color.setHex(0xffffff);
                                mat.emissive.setHex(0x000000);
                            }
                            keyMesh.position.y = defaultY; // 元の位置に戻す

                            // 境界線も元の位置に戻す
                            if (pianoEdgesRef.current[index]) {
                                pianoEdgesRef.current[index].position.y = defaultEdgeY;
                            }
                        }

                        // ラベルが存在する場合、ローカルオフセットを維持して鍵盤に貼り付ける
                        if (pianoLabelsRef.current[index]) {
                            const label = pianoLabelsRef.current[index];
                            const labelOffset = (label.userData && typeof label.userData.labelOffset === 'number')
                                ? label.userData.labelOffset
                                : (note.isBlack ? 0.08 - defaultY : 0.07 - defaultY);
                            // 子要素のローカルYをラベルオフセットに固定
                            label.position.y = labelOffset;
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

            // WebSocketを適切に破棄
            if (wsRef.current) {
                try {
                    const state = wsRef.current.readyState;
                    if (state === WebSocket.OPEN) {
                        wsRef.current.close();
                    } else if (state === WebSocket.CONNECTING) {
                        // CONNECTING の場合はイベントを外して参照を切る（ブラウザの警告を防ぐため）
                        try { wsRef.current.onopen = null; } catch (e) { }
                        try { wsRef.current.onmessage = null; } catch (e) { }
                        try { wsRef.current.onclose = null; } catch (e) { }
                        try { wsRef.current.onerror = null; } catch (e) { }
                        wsRef.current = null;
                    } else {
                        wsRef.current = null;
                    }
                } catch (e) {
                    wsRef.current = null;
                }
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
        const centerAngle = ((startAngleRef.current + endAngleRef.current) / 2.0) - 90;
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
        if (!centerContext) return;
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
        centerSprite.renderOrder = 2; // 点群よりも手前に表示させる
        scene.add(centerSprite);
        centerTextRef.current = centerSprite;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(360 * 3);
        const colors = new Float32Array(360 * 3);
        const alphas = new Float32Array(360);

        for (let i = 0; i < 360; i++) {
            positions[i * 3] = 0.0;
            // 初期Yは pointHeightRef を使って鍵盤の文字より上に表示
            positions[i * 3 + 1] = pointHeightRef.current;
            positions[i * 3 + 2] = 0.0;

            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.0;
            colors[i * 3 + 2] = 0.5;

            alphas[i] = 1.0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

        // 点描画用テクスチャ: コアはシャープ、グローはふわっと
        const createCoreTexture = (size = 64) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return new THREE.CanvasTexture(canvas);

            const cx = size / 2;
            const cy = size / 2;
            const r = size * 0.22; // コアは小さめ

            ctx.clearRect(0, 0, size, size);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,255,255,1.0)';
            ctx.fill();

            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.needsUpdate = true;

            return texture;
        };

        // 各点の外周に白い輪郭（Outline）を付けるためのテクスチャを生成
        const createOutlineTexture = (size = 128) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return new THREE.CanvasTexture(canvas);

            const cx = size / 2;
            const cy = size / 2;
            const r = size / 2;

            // 中心は透明、外側に向かって白のリングを描く
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
            grad.addColorStop(0.45, 'rgba(255,255,255,1.0)');
            grad.addColorStop(0.55, 'rgba(255,255,255,1.0)');
            grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');

            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, size);

            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.needsUpdate = true;
            return tex;
        };

        const outlineTexture = createOutlineTexture(128);
        const outlineMaterial = new THREE.PointsMaterial({
            size: 0.055, // core より少し大きめにして輪郭を表示
            map: outlineTexture,
            color: 0xffffff,
            vertexColors: false,
            sizeAttenuation: true,
            transparent: true,
            depthWrite: false,
        });

        // まず輪郭を描画（背景）、その上にコアを重ねる
        const pointsOutline = new THREE.Points(geometry, outlineMaterial);
        pointsOutline.renderOrder = 1;
        scene.add(pointsOutline);

        // コア用テクスチャとマテリアルを作成
        const coreTexture = createCoreTexture(64);
        const coreMaterial = new THREE.PointsMaterial({
            size: 0.04,
            map: coreTexture,
            vertexColors: true,
            sizeAttenuation: true,
            transparent: true,
            depthWrite: false,
            alphaTest: 0.01,
        });

        // まず輪郭を描画（背景）、その上にコアを重ねる
        const pointsCore = new THREE.Points(geometry, coreMaterial);
        pointsCore.renderOrder = 1;
        scene.add(pointsCore);
        pointsRef.current = pointsCore;

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
            // 点群オブジェクトをシーンから削除し、マテリアル/テクスチャを破棄
            try {
                if (pointsCore) {
                    scene.remove(pointsCore);
                }
            } catch (e) { }

            geometry.dispose();
            try { coreMaterial.dispose(); } catch (e) { }
            try { if (coreTexture) coreTexture.dispose(); } catch (e) { }
            // pointsOutlineがあれば削除/破棄
            try { if (pointsOutline) scene.remove(pointsOutline); } catch (e) { }
            try { if (outlineMaterial) outlineMaterial.dispose(); } catch (e) { }
            try { if (outlineTexture) outlineTexture.dispose(); } catch (e) { }

            renderer.dispose();
        };
    }, []);

    return (
        <div ref={wrapperRef} className={mobilePanelsVisible ? 'mobile-panels-visible' : ''} style={{ width: '100%', height: '100vh' }} onClick={enableAudio}>
            {/* モバイル用トグルボタン（幅が狭いときに表示される） */}
            <button
                className="mobile-toggle"
                onClick={(e) => { e.stopPropagation(); setMobilePanelsVisible(v => !v); }}
                aria-label="Toggle panels"
                title="表示/非表示"
            >
                ☰
            </button>
            {/* 全画面切替ボタン */}
            <button
                className="fullscreen-toggle"
                onClick={(e) => {
                    e.stopPropagation();
                    try {
                        if (!document.fullscreenElement) {
                            // Request fullscreen on the wrapper so all UI remains visible
                            if (wrapperRef.current && (wrapperRef.current as any).requestFullscreen) {
                                (wrapperRef.current as any).requestFullscreen();
                            } else if (containerRef.current && (containerRef.current as any).requestFullscreen) {
                                // fallback to container if wrapper isn't available
                                (containerRef.current as any).requestFullscreen();
                            } else if (document.documentElement.requestFullscreen) {
                                document.documentElement.requestFullscreen();
                            }
                        } else {
                            if (document.exitFullscreen) document.exitFullscreen();
                        }
                    } catch (err) {
                        console.warn('Failed to toggle fullscreen', err);
                    }
                }}
                aria-label="Toggle fullscreen"
                title="全画面切替"
            >
                {isFullscreen ? '⤢' : '⤡'}
            </button>
            <div
                ref={containerRef}
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'relative'
                }}
            />

            {/* 中央上部: タイトル */}
            <div className="title-container" aria-hidden>
                <div className="title-main">ピアノ</div>
                <div className="title-sub">LiDAR FOOT PIANO</div>
            </div>

            {/* fullscreenchange イベントで状態を同期 */}
            {/* useEffect below ensures isFullscreen state follows document.fullscreenElement */}

            {/* 左上: LiDAR情報 */}
            <div
                className="panel-left"
                style={{
                    position: 'absolute',
                    top: 10,
                    left: 10,
                    color: 'white',
                    background: 'rgba(0, 0, 0, 0.7)',
                    padding: '10px',
                    borderRadius: '5px',
                    fontFamily: "'Noto Sans JP', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                    fontSize: '14px'
                }}
            >
                <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
                    🎯 SonicRing
                </div>
                <div>WebSocket: <span style={{ color: wsStatus === 'connected' ? '#0f0' : '#f00' }}>{wsStatus}</span></div>
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
                className="panel-right"
                style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    color: 'white',
                    background: 'rgba(0, 0, 0, 0.7)',
                    padding: '10px',
                    borderRadius: '5px',
                    fontFamily: "'Noto Sans JP', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
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

                    <div>開始角度: <strong>{startAngle}°</strong></div>
                    <input
                        type="range"
                        min={-90}
                        max={270}
                        step={1}
                        value={startAngle}
                        onChange={(e) => {
                            e.stopPropagation();
                            let v = parseInt(e.target.value, 10);
                            // start は end より小さくする（最小差1度）
                            if (v >= endAngle) v = endAngle - 1;
                            setStartAngle(v);
                            startAngleRef.current = v;
                        }}
                    />

                    <div>終了角度: <strong>{endAngle}°</strong></div>
                    <input
                        type="range"
                        min={-90}
                        max={270}
                        step={1}
                        value={endAngle}
                        onChange={(e) => {
                            e.stopPropagation();
                            let v = parseInt(e.target.value, 10);
                            // end は start より大きくする（最小差1度）
                            if (v <= startAngle) v = startAngle + 1;
                            setEndAngle(v);
                            endAngleRef.current = v;
                        }}
                    />


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
                        {(['sine', 'triangle', 'sawtooth', 'square'] as OscillatorType[]).map(type => (
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
                        {decayEnabled ? 'ON' : 'OFF'}
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
