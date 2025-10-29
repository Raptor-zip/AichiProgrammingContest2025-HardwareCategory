
let ws;
let seq = 0;
let sentCount = 0;
let recvCount = 0;
let timer = null;
let stats = { min: Infinity, max: -Infinity, sum: 0 };

// 高精度タイムスタンプを返す。可能なら performance.timeOrigin + performance.now() を使い、
// サポートがなければ Date.now() にフォールバックする。
function nowMs() {
    if (window.performance && typeof performance.now === 'function' && typeof performance.timeOrigin === 'number') {
        return performance.timeOrigin + performance.now();
    }
    // 古いブラウザや特殊環境のためのフォールバック
    return Date.now();
}

function connectWS() {
    const h = location.hostname || "192.168.4.1"; // softAP のデフォルト IP
    const url = `ws://${h}:81/`;
    ws = new WebSocket(url);
    document.getElementById('wsStatus').textContent = 'connecting...';

    ws.onopen = () => {
        document.getElementById('wsStatus').textContent = 'open';
        document.getElementById('startBtn').disabled = false;
    };

    ws.onclose = () => {
        document.getElementById('wsStatus').textContent = 'closed';
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        if (timer) { clearInterval(timer); timer = null; }
    };

    ws.onerror = (e) => {
        console.error("WS error", e);
        document.getElementById('wsStatus').textContent = 'error';
    };

    ws.onmessage = (ev) => {
        // 受け取ったメッセージをそのまま parse して RTT を計算する
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'ping') {
                const now = nowMs();
                const rtt = now - msg.t;
                recvCount++;
                stats.sum += rtt;
                if (rtt < stats.min) stats.min = rtt;
                if (rtt > stats.max) stats.max = rtt;
                document.getElementById('recv').textContent = recvCount;
                document.getElementById('last').textContent = (Math.round(rtt * 1000) / 1000).toFixed(3);
                document.getElementById('min').textContent = (isFinite(stats.min) ? (Math.round(stats.min * 1000) / 1000).toFixed(3) : '-');
                document.getElementById('max').textContent = (isFinite(stats.max) ? (Math.round(stats.max * 1000) / 1000).toFixed(3) : '-');
                document.getElementById('avg').textContent = (recvCount ? (Math.round((stats.sum / recvCount) * 1000) / 1000).toFixed(3) : '-');

                // ログ表示（小数点以下3桁で表示）
                const tbody = document.querySelector('#logTable tbody');
                const tr = document.createElement('tr');
                const sentT = (typeof msg.t === 'number') ? msg.t.toFixed(3) : msg.t;
                tr.innerHTML = `<td>${msg.id}</td><td>${sentT}</td><td>${now.toFixed(3)}</td><td>${rtt.toFixed(3)}</td>`;
                tbody.insertBefore(tr, tbody.firstChild);
                // 保持数を制限
                while (tbody.children.length > 200) tbody.removeChild(tbody.lastChild);
            }
        } catch (e) {
            console.warn("Invalid JSON from server", e);
        }
    };
}

function startPing() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert("WebSocket not open");
        return;
    }
    const interval = Number(document.getElementById('interval').value) || 1000;
    seq = 0;
    sentCount = 0;
    recvCount = 0;
    stats = { min: Infinity, max: -Infinity, sum: 0 };
    document.getElementById('sent').textContent = sentCount;
    document.getElementById('recv').textContent = recvCount;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;

    timer = setInterval(() => {
        seq++;
        const payload = { type: "ping", id: seq, t: nowMs() };
        ws.send(JSON.stringify(payload));
        sentCount++;
        document.getElementById('sent').textContent = sentCount;
    }, interval);
}

function stopPing() {
    if (timer) { clearInterval(timer); timer = null; }
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
}

document.getElementById('startBtn').addEventListener('click', startPing);
document.getElementById('stopBtn').addEventListener('click', stopPing);

connectWS();