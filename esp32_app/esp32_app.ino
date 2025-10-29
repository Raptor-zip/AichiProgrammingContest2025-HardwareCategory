// ESP32 Ping-Pong WebSocket + HTTP server example
// - HTTP server on port 80 serves the webpage
// - WebSocket server on port 81 echoes whatever it receives (ping -> pong echo)
// - Browser sends {"type":"ping","id":N,"t":<ms since epoch>} and measures RTT

#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h> // https://github.com/Links2004/arduinoWebSockets

// ----- 設定 -----
// STA（既存のWi‑Fi）に接続して動作させる（ここを書き換えてください）
const char *wifi_ssid = "raptor";
const char *wifi_pass = "12345678";

WebServer httpServer(80);
WebSocketsServer wsServer(81);

// HTML ページ（React版 — CSS/JSはCDNから読み込み）
const char index_html[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <title>ESP32 WebSocket Ping測定</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Raptor-zip/AichiProgrammingContest2025-HardwareCategory@main/gui/dist/app.css">
</head>
<body>
    <div id="root"></div>
    <script type="module" src="https://cdn.jsdelivr.net/gh/Raptor-zip/AichiProgrammingContest2025-HardwareCategory@main/gui/dist/app.js"></script>
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
    Serial.begin(921600);
    delay(100);

    Serial.println();
    // STA のみで動かす -> 既存Wi-Fiに接続を試みる
    Serial.printf("Connecting to WiFi '%s'\n", wifi_ssid);
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifi_ssid, wifi_pass);
    unsigned long start = millis();
    Serial.print("Connecting");
    // 最大30秒待つ
    while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
        Serial.print('.');
        delay(500);
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
        IPAddress myIP = WiFi.localIP();
        Serial.print("Connected. IP address: ");
        Serial.println(myIP);
    } else {
        // STA のみ => 失敗したら先に進まず停止して原因を直す
        Serial.println("Failed to connect to WiFi (STA-only). Halting.");
        while (true) {
            delay(1000);
        }
    }

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
