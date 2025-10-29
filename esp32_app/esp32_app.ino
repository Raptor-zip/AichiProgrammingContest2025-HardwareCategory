// ESP32 Ping-Pong WebSocket + HTTP server example
// - HTTP server on port 80 serves the webpage
// - WebSocket server on port 81 echoes whatever it receives (ping -> pong echo)
// - Browser sends {"type":"ping","id":N,"t":<ms since epoch>} and measures RTT

#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h> // https://github.com/Links2004/arduinoWebSockets

// ----- 設定 -----
// SoftAP 設定（そのまま使いたければこのまま。STAで既存APに接続したければ WiFi.mode(WIFI_STA) のほうが良い）
const char *ap_ssid = "ESP32-PingPong";
const char *ap_pass = "password123"; // 空文字にするとオープンAPになる

WebServer httpServer(80);
WebSocketsServer wsServer(81);

// HTML ページ（簡易版 — JS はブラウザ側で RTT を計測）
const char index_html[] PROGMEM = R"rawliteral(
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>ESP32 Ping-Pong RTT Tester</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif; padding:16px; }
    .status { margin-bottom:8px; }
    button { padding:8px 12px; margin-right:8px; }
    .stat { margin-top:12px; }
    table { border-collapse: collapse; width:100%; margin-top:8px; }
    td, th { border:1px solid #ddd; padding:6px; text-align:left; }
  </style>
</head>
<body>
  <h2>ESP32 Ping-Pong RTT Tester</h2>
  <div class="status">WebSocket: <span id="wsStatus">-</span></div>
  <div>
    <button id="startBtn">Start</button>
    <button id="stopBtn" disabled>Stop</button>
    Interval(ms): <input id="interval" type="number" value="1000" style="width:80px">
  </div>

  <div class="stat">
    Sent: <span id="sent">0</span> |
    Received: <span id="recv">0</span> |
    Last RTT: <span id="last">-</span> ms |
    Min: <span id="min">-</span> ms |
    Max: <span id="max">-</span> ms |
    Avg: <span id="avg">-</span> ms
  </div>

  <table id="logTable">
    <thead><tr><th>#</th><th>sent t (ms)</th><th>recv t (ms)</th><th>RTT (ms)</th></tr></thead>
    <tbody></tbody>
  </table>

<script>
let ws;
let seq = 0;
let sentCount = 0;
let recvCount = 0;
let timer = null;
let stats = {min: Infinity, max: -Infinity, sum: 0};

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
        const now = Date.now();
        const rtt = now - msg.t;
        recvCount++;
        stats.sum += rtt;
        if (rtt < stats.min) stats.min = rtt;
        if (rtt > stats.max) stats.max = rtt;
        document.getElementById('recv').textContent = recvCount;
        document.getElementById('last').textContent = rtt;
        document.getElementById('min').textContent = (isFinite(stats.min) ? stats.min : '-');
        document.getElementById('max').textContent = (isFinite(stats.max) ? stats.max : '-');
        document.getElementById('avg').textContent = (recvCount? Math.round(stats.sum/recvCount) : '-');

        // ログ表示
        const tbody = document.querySelector('#logTable tbody');
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${msg.id}</td><td>${msg.t}</td><td>${now}</td><td>${rtt}</td>`;
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
  stats = {min: Infinity, max: -Infinity, sum: 0};
  document.getElementById('sent').textContent = sentCount;
  document.getElementById('recv').textContent = recvCount;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;

  timer = setInterval(() => {
    seq++;
    const payload = { type: "ping", id: seq, t: Date.now() };
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
</script>
</body>
</html>
)rawliteral";

void onWsEvent(uint8_t client_num, WStype_t type, uint8_t *payload, size_t length)
{
    switch (type)
    {
    case WStype_DISCONNECTED:
        Serial.printf("[WS] Client %u disconnected\n", client_num);
        break;
    case WStype_CONNECTED:
    {
        IPAddress ip = wsServer.remoteIP(client_num);
        Serial.printf("[WS] Client %u connected from %s\n", client_num, ip.toString().c_str());
        break;
    }
    case WStype_TEXT:
    {
        // 受けたテキストをそのまま送り返す（エコー）
        // payload は null 終端されているはず
        Serial.printf("[WS] recv from %u: %s\n", client_num, (char *)payload);
        wsServer.sendTXT(client_num, payload, length); // エコー -> ブラウザが RTT を計算する
        break;
    }
    default:
        break;
    }
}

void handleRoot()
{
    httpServer.sendHeader("Content-Type", "text/html; charset=utf-8");
    httpServer.send(200, "text/html", index_html);
}

void setup()
{
    Serial.begin(115200);
    delay(100);

    Serial.println();
    Serial.printf("Starting SoftAP '%s'\n", ap_ssid);
    WiFi.mode(WIFI_AP);
    WiFi.softAP(ap_ssid, ap_pass);
    IPAddress myIP = WiFi.softAPIP();
    Serial.print("AP IP address: ");
    Serial.println(myIP);

    // HTTP
    httpServer.on("/", handleRoot);
    httpServer.begin();
    Serial.println("HTTP server started on port 80");

    // WebSocket
    wsServer.begin();
    wsServer.onEvent(onWsEvent);
    Serial.println("WebSocket server started on port 81");
}

void loop()
{
    wsServer.loop();
    httpServer.handleClient();
    // 小休止
    delay(1);
}
