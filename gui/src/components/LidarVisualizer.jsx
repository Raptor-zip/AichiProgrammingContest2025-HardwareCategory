import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const LidarVisualizer = () => {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const rendererRef = useRef(null);
    const pointsRef = useRef(null);
    const animationIdRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // シーンのセットアップ
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        sceneRef.current = scene;

        // カメラのセットアップ
        const camera = new THREE.PerspectiveCamera(
            75,
            containerRef.current.clientWidth / containerRef.current.clientHeight,
            0.1,
            1000
        );
        camera.position.set(5, 5, 5);
        camera.lookAt(0, 0, 0);

        // レンダラーのセットアップ
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // コントロールのセットアップ
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;

        // グリッドヘルパー
        const gridHelper = new THREE.GridHelper(10, 10);
        scene.add(gridHelper);

        // 軸ヘルパー
        const axesHelper = new THREE.AxesHelper(5);
        scene.add(axesHelper);

        // 円盤の追加
        const ringShape = new THREE.Shape();
        ringShape.absarc(0, 0, 1.5, 0, Math.PI * 2, false); // 外円
        const holePath = new THREE.Path();
        holePath.absarc(0, 0, 0.5, 0, Math.PI * 2, true); // 内円(穴)
        ringShape.holes.push(holePath);

        const ringGeometry = new THREE.ShapeGeometry(ringShape);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.3
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2; // XZ平面に配置(水平)
        scene.add(ring);

        // 点群用のジオメトリとマテリアル
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(4000 * 3); // 4000点 × (x, y, z)
        const colors = new Float32Array(4000 * 3); // 4000点 × (r, g, b)

        // 初期位置と色の設定
        for (let i = 0; i < 4000; i++) {
            positions[i * 3] = 0.0;
            positions[i * 3 + 1] = 0.0;
            positions[i * 3 + 2] = 0.0;

            // 距離に基づいた色付け
            const distance = Math.sqrt(
                positions[i * 3] ** 2 +
                positions[i * 3 + 1] ** 2 +
                positions[i * 3 + 2] ** 2
            );
            const normalizedDistance = distance / 10;
            colors[i * 3] = normalizedDistance; // R
            colors[i * 3 + 1] = 1 - normalizedDistance; // G
            colors[i * 3 + 2] = 0.5; // B
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.02,
            vertexColors: true,
            sizeAttenuation: true
        });

        const points = new THREE.Points(geometry, material);
        scene.add(points);
        pointsRef.current = points;

        // パフォーマンス測定用
        let lastUpdateTime = Date.now();
        let frameCount = 0;
        let fps = 0;

        // 10Hzで点群を更新
        const updateInterval = setInterval(() => {
            const positions = points.geometry.attributes.position.array;
            const colors = points.geometry.attributes.color.array;

            // LiDARデータをシミュレート
            const time = 1;
            for (let i = 0; i < 4000; i++) {
                const angle = (i / 4000) * Math.PI * 2;
                const radius = 0.5 + Math.random() * 1;

                positions[i * 3] = Math.cos(angle + time * 0.5) * radius;
                //   positions[i * 3] = 0.0;
                positions[i * 3 + 1] = 0.0;
                positions[i * 3 + 2] = Math.sin(angle + time * 0.5) * radius;
                //   positions[i * 3 + 2] = 0.0;

                // 距離に基づいた色更新
                const distance = Math.sqrt(
                    positions[i * 3] ** 2 +
                    positions[i * 3 + 1] ** 2 +
                    positions[i * 3 + 2] ** 2
                );
                const normalizedDistance = distance / 8;
                colors[i * 3] = normalizedDistance;
                colors[i * 3 + 1] = 1 - normalizedDistance;
                colors[i * 3 + 2] = 0.5 + Math.sin(time) * 0.5;
            }

            points.geometry.attributes.position.needsUpdate = true;
            points.geometry.attributes.color.needsUpdate = true;

            // FPS計算
            frameCount++;
            const now = Date.now();
            if (now - lastUpdateTime >= 1000) {
                fps = frameCount;
                frameCount = 0;
                lastUpdateTime = now;
                console.log(`Update Rate: 10Hz, Render FPS: ${fps}`);
            }
        }, 100); // 100ms = 10Hz

        // アニメーションループ
        const animate = () => {
            animationIdRef.current = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        // ウィンドウリサイズ対応
        const handleResize = () => {
            if (!containerRef.current) return;
            camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        // クリーンアップ
        return () => {
            window.removeEventListener('resize', handleResize);
            clearInterval(updateInterval);
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
                    fontFamily: 'monospace'
                }}
            >
                <div>LiDAR Point Cloud Visualization</div>
                <div>Points: 4000</div>
                <div>Update Rate: 10Hz</div>
                <div>Controls: Mouse to rotate, scroll to zoom</div>
            </div>
        </div>
    );
};

export default LidarVisualizer;
