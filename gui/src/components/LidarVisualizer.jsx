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

const LidarVisualizer = () => {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const rendererRef = useRef(null);
    const pointsRef = useRef(null);
    const animationIdRef = useRef(null);
    const wsRef = useRef(null);
    const pingTimerRef = useRef(null);
    const pingSeqRef = useRef(0);

    const [wsStatus, setWsStatus] = useState('disconnected');
    const [frameCount, setFrameCount] = useState(0);
    const [fps, setFps] = useState(0);
    const [lastTimestamp, setLastTimestamp] = useState(0);
    const [pingEnabled, setPingEnabled] = useState(false);
    const [pingStats, setPingStats] = useState({ min: Infinity, max: -Infinity, avg: 0, count: 0 });
    const [lastRTT, setLastRTT] = useState(0);

    // WebSocket接続とバイナリデータ受信
    useEffect(() => {
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

        const ringShape = new THREE.Shape();
        ringShape.absarc(0, 0, 3.0, 0, Math.PI * 2, false);
        const holePath = new THREE.Path();
        holePath.absarc(0, 0, 0.5, 0, Math.PI * 2, true);
        ringShape.holes.push(holePath);

        const ringGeometry = new THREE.ShapeGeometry(ringShape);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.2
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        scene.add(ring);

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
        <div style={{ width: '100%', height: '100vh' }}>
            <div
                ref={containerRef}
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'relative'
                }}
            />
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
            </div>
        </div>
    );
};

export default LidarVisualizer;
