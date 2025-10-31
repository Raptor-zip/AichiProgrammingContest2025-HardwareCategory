import { useEffect, useRef, useState } from 'react';
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
    innerRadius: 0.5,      // 内径 (m)
    outerRadius: 1.0,      // 外径 (m)
    startAngle: -90,       // 開始角度 (度)
    endAngle: 90,          // 終了角度 (度)
    detectionThreshold: 0.2, // 検出閾値 (m) - この距離以下なら足を検出
};

// ピアノ音階定義 (C4 = ド)
const PIANO_NOTES = [
    { note: 'C4', freq: 261.63, name: 'ド', isBlack: false },
    { note: 'C#4', freq: 277.18, name: 'ド#', isBlack: true },
    { note: 'D4', freq: 293.66, name: 'レ', isBlack: false },
    { note: 'D#4', freq: 311.13, name: 'レ#', isBlack: true },
    { note: 'E4', freq: 329.63, name: 'ミ', isBlack: false },
    { note: 'F4', freq: 349.23, name: 'フ', isBlack: false },
    { note: 'F#4', freq: 369.99, name: 'フ#', isBlack: true },
    { note: 'G4', freq: 392.00, name: 'ソ', isBlack: false },
    { note: 'G#4', freq: 415.30, name: 'ソ#', isBlack: true },
    { note: 'A4', freq: 440.00, name: 'ラ', isBlack: false },
    { note: 'A#4', freq: 466.16, name: 'ラ#', isBlack: true },
    { note: 'B4', freq: 493.88, name: 'シ', isBlack: false },
];

// Web Audio API用の音声生成
class PianoSynth {
    constructor() {
        this.audioContext = null;
        this.oscillators = new Map();
        this.gainNodes = new Map();
    }

    init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playNote(freq, noteName) {
        this.init();

        // 既に鳴っている音を停止
        if (this.oscillators.has(noteName)) {
            this.stopNote(noteName);
        }

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, this.audioContext.currentTime);

        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.01);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.start();

        this.oscillators.set(noteName, oscillator);
        this.gainNodes.set(noteName, gainNode);
    }

    stopNote(noteName) {
        const oscillator = this.oscillators.get(noteName);
        const gainNode = this.gainNodes.get(noteName);

        if (oscillator && gainNode) {
            gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
            oscillator.stop(this.audioContext.currentTime + 0.1);
            this.oscillators.delete(noteName);
            this.gainNodes.delete(noteName);
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
    const pingSeqRef = useRef(0);
    const synthRef = useRef(null);
    const pianoKeysRef = useRef([]); // ピアノ鍵盤のメッシュ配列
    const activeNotesRef = useRef(new Set()); // 現在鳴っている音

    const [wsStatus, setWsStatus] = useState('disconnected');
    const [frameCount, setFrameCount] = useState(0);
    const [fps, setFps] = useState(0);
    const [lastTimestamp, setLastTimestamp] = useState(0);
    const [pingEnabled, setPingEnabled] = useState(false);
    const [pingStats, setPingStats] = useState({ min: Infinity, max: -Infinity, avg: 0, count: 0 });
    const [lastRTT, setLastRTT] = useState(0);
    const [currentNotes, setCurrentNotes] = useState([]); // 現在踏んでいる音
    const [audioEnabled, setAudioEnabled] = useState(false); // オーディオ有効化状態

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

        console.log('Connecting to WebSocket:', url);
        setWsStatus('connecting');
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('WebSocket connected');
            setWsStatus('connected');

            // 接続後、自動的にPing送信開始（1秒間隔）
            pingSeqRef.current = 0;
            setPingStats({ min: Infinity, max: -Infinity, avg: 0, count: 0 });

            pingTimerRef.current = setInterval(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    pingSeqRef.current++;
                    const payload = { type: 'ping', id: pingSeqRef.current, t: nowMs() };
                    wsRef.current.send(JSON.stringify(payload));
                }
            }, 1000); // 1秒間隔でPing送信

            setPingEnabled(true);
        };

        ws.onclose = (e) => {
            console.log('WebSocket closed:', e.code, e.reason);
            setWsStatus('disconnected');
        };

        ws.onerror = (e) => {
            console.error('WebSocket error:', e);
            setWsStatus('error');
        };

        let receivedFrames = 0;
        let lastFpsUpdate = Date.now();

        ws.onmessage = (event) => {
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

                // 点群を更新
                if (pointsRef.current) {
                    const positions = pointsRef.current.geometry.attributes.position.array;
                    const colors = pointsRef.current.geometry.attributes.color.array;

                    for (let i = 0; i < 360; i++) {
                        const angle = (i * Math.PI) / 180.0;
                        const distance = distances[i];

                        positions[i * 3] = Math.cos(angle) * distance;
                        positions[i * 3 + 1] = 0.0;
                        positions[i * 3 + 2] = Math.sin(angle) * distance;

                        const normalizedDistance = Math.min(distance / 3.0, 1.0);
                        colors[i * 3] = normalizedDistance;
                        colors[i * 3 + 1] = 1 - normalizedDistance;
                        colors[i * 3 + 2] = 0.5;
                    }

                    pointsRef.current.geometry.attributes.position.needsUpdate = true;
                    pointsRef.current.geometry.attributes.color.needsUpdate = true;
                }

                // ピアノ鍵盤の足検出
                const detectedNotes = [];
                const { innerRadius, outerRadius, startAngle, endAngle, detectionThreshold } = PIANO_CONFIG;
                const angleRange = endAngle - startAngle;
                const degreesPerKey = angleRange / PIANO_NOTES.length;

                for (let i = 0; i < 360; i++) {
                    const angleDeg = i - 90; // LiDARの0度を前方に調整
                    const distance = distances[i];

                    // ピアノの角度範囲内かチェック
                    if (angleDeg >= startAngle && angleDeg <= endAngle) {
                        // 距離がピアノの範囲内かチェック
                        if (distance >= innerRadius && distance <= outerRadius) {
                            // 検出閾値以下なら足を検出
                            const baselineDistance = (innerRadius + outerRadius) / 2;
                            if (distance < baselineDistance - detectionThreshold) {
                                // どの鍵盤か判定
                                const relativeAngle = angleDeg - startAngle;
                                const keyIndex = Math.floor(relativeAngle / degreesPerKey);

                                if (keyIndex >= 0 && keyIndex < PIANO_NOTES.length) {
                                    const note = PIANO_NOTES[keyIndex];
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

                // 鍵盤の色を更新
                pianoKeysRef.current.forEach((keyMesh, index) => {
                    const note = PIANO_NOTES[index];
                    const isActive = detectedNotes.some(n => n.note === note.note);

                    if (isActive) {
                        keyMesh.material.color.setHex(0xffff00); // 黄色（踏まれている）
                        keyMesh.material.emissive.setHex(0xff8800);
                    } else {
                        // デフォルトの色に戻す
                        if (note.isBlack) {
                            keyMesh.material.color.setHex(0x333333);
                            keyMesh.material.emissive.setHex(0x000000);
                        } else {
                            keyMesh.material.color.setHex(0xffffff);
                            keyMesh.material.emissive.setHex(0x000000);
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
                        const now = nowMs();
                        const rtt = now - msg.t;
                        setLastRTT(rtt);

                        setPingStats(prev => {
                            const newCount = prev.count + 1;
                            const newSum = (prev.avg * prev.count) + rtt;
                            return {
                                min: Math.min(prev.min, rtt),
                                max: Math.max(prev.max, rtt),
                                avg: newSum / newCount,
                                count: newCount
                            };
                        });
                    }
                } catch (e) {
                    console.warn('Invalid JSON from server', e);
                }
            }
        };

        return () => {
            console.log('Cleaning up WebSocket');
            if (pingTimerRef.current) {
                clearInterval(pingTimerRef.current);
            }
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
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
        camera.position.set(5, 5, 5);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;

        const gridHelper = new THREE.GridHelper(10, 10);
        scene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(5);
        scene.add(axesHelper);

        // ピアノ鍵盤の作成
        const { innerRadius, outerRadius, startAngle, endAngle } = PIANO_CONFIG;
        const angleRange = endAngle - startAngle;
        const degreesPerKey = angleRange / PIANO_NOTES.length;
        const keys = [];

        PIANO_NOTES.forEach((note, index) => {
            const startDeg = startAngle + (index * degreesPerKey);
            const endDeg = startDeg + degreesPerKey;

            // ラジアンに変換（-90度オフセット: LiDARの0度=前方）
            const startRad = ((startDeg + 90) * Math.PI) / 180;
            const endRad = ((endDeg + 90) * Math.PI) / 180;

            // 黒鍵は外側、白鍵は内側から外側まで
            const keyInnerRadius = note.isBlack ? (innerRadius + outerRadius) / 2 : innerRadius;
            const keyOuterRadius = outerRadius;

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

            const keyGeometry = new THREE.ShapeGeometry(keyShape);
            const keyMaterial = new THREE.MeshStandardMaterial({
                color: note.isBlack ? 0x333333 : 0xffffff,
                emissive: 0x000000,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: note.isBlack ? 0.7 : 0.9
            });

            const keyMesh = new THREE.Mesh(keyGeometry, keyMaterial);
            keyMesh.rotation.x = -Math.PI / 2;
            keyMesh.position.y = note.isBlack ? 0.02 : 0.01; // 黒鍵を少し上に
            scene.add(keyMesh);
            keys.push(keyMesh);

            // 鍵盤の境界線を追加
            const edgeGeometry = new THREE.EdgesGeometry(keyGeometry);
            const edgeMaterial = new THREE.LineBasicMaterial({
                color: note.isBlack ? 0x666666 : 0x888888,
                linewidth: 2
            });
            const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
            edges.rotation.x = -Math.PI / 2;
            edges.position.y = note.isBlack ? 0.021 : 0.011; // 鍵盤より少し上
            scene.add(edges);
        });

        pianoKeysRef.current = keys;

        // 照明を追加（MeshStandardMaterialのため）
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 5);
        scene.add(directionalLight);

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(360 * 3);
        const colors = new Float32Array(360 * 3);

        for (let i = 0; i < 360; i++) {
            positions[i * 3] = 0.0;
            positions[i * 3 + 1] = 0.0;
            positions[i * 3 + 2] = 0.0;

            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.0;
            colors[i * 3 + 2] = 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.05,
            vertexColors: true,
            sizeAttenuation: true
        });

        const points = new THREE.Points(geometry, material);
        scene.add(points);
        pointsRef.current = points;

        const animate = () => {
            animationIdRef.current = requestAnimationFrame(animate);
            controls.update();
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
                    🎯 LiDAR Point Cloud Visualization
                </div>
                <div>WebSocket: <span style={{ color: wsStatus === 'connected' ? '#0f0' : '#f00' }}>{wsStatus}</span></div>
                <div>Points: 360 (1° resolution)</div>
                <div>Update Rate: {fps} Hz</div>
                <div>Frame Count: {frameCount}</div>
                <div>Timestamp: {lastTimestamp} ms</div>

                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '5px' }}>
                        📡 WebSocket Ping (Auto)
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

            {/* 中央上部: 演奏中の音符 */}
            <div
                style={{
                    position: 'absolute',
                    top: 20,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: 'white',
                    background: 'rgba(0, 0, 0, 0.8)',
                    padding: '20px 40px',
                    borderRadius: '15px',
                    fontFamily: 'sans-serif',
                    fontSize: '48px',
                    fontWeight: 'bold',
                    minWidth: '300px',
                    textAlign: 'center',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
                }}
            >
                <div style={{ fontSize: '24px', marginBottom: '10px', opacity: 0.7 }}>
                    🎹 演奏中の音
                </div>
                <div style={{
                    fontSize: '64px',
                    color: currentNotes.length > 0 ? '#ffff00' : '#666',
                    textShadow: currentNotes.length > 0 ? '0 0 20px rgba(255, 255, 0, 0.8)' : 'none'
                }}>
                    {currentNotes.length > 0
                        ? currentNotes.map(n => n.label).join(' + ')
                        : '---'
                    }
                </div>
                <div style={{ fontSize: '18px', marginTop: '10px', opacity: 0.6 }}>
                    {currentNotes.length > 0
                        ? currentNotes.map(n => n.note).join(', ')
                        : '足を鍵盤に乗せてください'
                    }
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
                <div>内側半径: {PIANO_CONFIG.innerRadius}m</div>
                <div>外側半径: {PIANO_CONFIG.outerRadius}m</div>
                <div>開始角度: {PIANO_CONFIG.startAngle}°</div>
                <div>終了角度: {PIANO_CONFIG.endAngle}°</div>
                <div>検出閾値: {PIANO_CONFIG.detectionThreshold}m</div>
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                    鍵盤数: {PIANO_NOTES.length}
                </div>
                <div>演奏中: {currentNotes.length} 音</div>
            </div>
        </div>
    );
};

export default LidarVisualizer;
