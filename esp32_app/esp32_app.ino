// ESP32 LiDAR WebSocket Binary Stream
// - HTTP server on port 80 serves the webpage
// - WebSocket server on port 81 sends binary LiDAR data at 10Hz
// - LiDAR data: 360 points (1 degree resolution), distance only

#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h> // https://github.com/Links2004/arduinoWebSockets

// ----- 設定 -----
const char *wifi_ssid = "raptor";
const char *wifi_pass = "12345678";

WebServer httpServer(80);
WebSocketsServer wsServer(81);

// LiDARデータ送信用
#define LIDAR_POINTS 360
#define LIDAR_UPDATE_HZ 10
#define LIDAR_UPDATE_INTERVAL_MS (1000 / LIDAR_UPDATE_HZ)

unsigned long lastLidarSendTime = 0;
uint32_t lidarFrameCount = 0;

// バイナリLiDARデータを生成して送信
// フォーマット:
// [Header: 8 bytes]
//   - type: uint8_t (0x01 = LiDAR data)
//   - reserved: uint8_t (0x00)
//   - point_count: uint16_t (360)
//   - timestamp: uint32_t (milliseconds)
// [Data: 360 × 4 bytes]
//   - distance: float (meters) × 360 points
void generateAndSendLidarData(uint8_t client_num)
{
    const size_t headerSize = 8;
    const size_t dataSize = LIDAR_POINTS * sizeof(float);
    const size_t totalSize = headerSize + dataSize;

    uint8_t *buffer = (uint8_t *)malloc(totalSize);
    if (!buffer) {
        Serial.println("[ERROR] Failed to allocate buffer for LiDAR data");
        return;
    }

    // ヘッダー構築
    buffer[0] = 0x01; // type: LiDAR data
    buffer[1] = 0x00; // reserved
    uint16_t pointCount = LIDAR_POINTS;
    memcpy(&buffer[2], &pointCount, sizeof(uint16_t));
    uint32_t timestamp = millis();
    memcpy(&buffer[4], &timestamp, sizeof(uint32_t));

    // サンプルLiDARデータ生成 (360度分)
    float *distances = (float *)(&buffer[headerSize]);
    float time = millis() / 1000.0f;

    for (int i = 0; i < LIDAR_POINTS; i++) {
        float angle = (i * PI) / 180.0f; // 度をラジアンに変換

        // 動的な円パターンを生成（シミュレーション用）
        float baseRadius = 1.5f + 0.5f * sin(time * 2.0f);
        float noise = 0.1f * sin(angle * 5.0f + time * 3.0f);
        float distance = baseRadius + noise;

        // ランダムな障害物を追加
        if ((i >= 45 && i <= 135) || (i >= 225 && i <= 315)) {
            distance *= 0.6f + 0.2f * sin(time * 4.0f);
        }

        distances[i] = distance;
    }

    // バイナリデータをWebSocketで送信
    wsServer.sendBIN(client_num, buffer, totalSize);

    free(buffer);
    lidarFrameCount++;

    if (lidarFrameCount % 10 == 0) {
        Serial.printf("[LiDAR] Sent frame %u to client %u\n", lidarFrameCount, client_num);
    }
}

// HTML ページ（React版 — CSS/JSはCDNから読み込み）
const char index_html[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <title>ESP32 LiDAR Visualization</title>
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
        // 接続時に即座に1フレーム送信
        generateAndSendLidarData(client_num);
        break;
    }
    case WStype_TEXT:
    {
        // Pingメッセージをエコーバック
        Serial.printf("[WS] recv from %u: %s\n", client_num, (char *)payload);
        wsServer.sendTXT(client_num, payload, length); // Pingエコー
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

    // 10HzでLiDARデータを送信
    unsigned long currentTime = millis();
    if (currentTime - lastLidarSendTime >= LIDAR_UPDATE_INTERVAL_MS) {
        lastLidarSendTime = currentTime;

        // 接続中の全クライアントにLiDARデータを送信
        for (uint8_t i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
            if (wsServer.clientIsConnected(i)) {
                generateAndSendLidarData(i);
            }
        }
    }

    delay(1);
}
