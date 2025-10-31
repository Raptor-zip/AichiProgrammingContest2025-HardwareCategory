// ESP32 LiDAR WebSocket Binary Stream
// - HTTP server on port 80 serves the webpage
// - WebSocket server on port 81 sends binary LiDAR data at 10Hz
// - LiDAR data: 360 points (1 degree resolution), distance only

#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsServer.h>  // https://github.com/Links2004/arduinoWebSockets
#include "LD06.h"

// ----- 設定 -----
const char *wifi_ssid = "raptor";
const char *wifi_pass = "12345678";

// 再接続設定
#define WIFI_RECONNECT_INTERVAL 5000  // WiFi再接続試行間隔 (5秒)
#define WIFI_MAX_RETRIES 10           // WiFi最大再接続試行回数
#define WIFI_RESET_AFTER_RETRIES 20   // この回数失敗したらリセット
#define WIFI_CHECK_INTERVAL 10000     // WiFi接続確認間隔 (10秒)

unsigned long lastWifiCheck = 0;
unsigned int wifiRetryCount = 0;

WebServer httpServer(80);
WebSocketsServer wsServer(81);

// LiDARデータ送信用
#define LIDAR_NUM_POINTS 360
#define LIDAR_DATA_HEADER_SIZE 8
#define LIDAR_DATA_BUF_SIZE (LIDAR_DATA_HEADER_SIZE + LIDAR_NUM_POINTS * sizeof(float))
#define LIDAR_DISTANCES ((float *)(lidarDataBuf + LIDAR_DATA_HEADER_SIZE))

uint8_t lidarDataBuf[LIDAR_DATA_BUF_SIZE] = { 0 };

// LD06構造体
LD06 ld06;

void LD06_onReceived(LD06 *lidar);
void sendLidarData();
void reconnectWiFi();
void checkWiFiConnection();

// HTML ページ
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
    <script>
      fetch("https://raw.githubusercontent.com/Raptor-zip/AichiProgrammingContest2025-HardwareCategory/refs/heads/main/gui/dist/app.js")
      .then(res => res.text())
      .then(code => eval(code));
    </script>
</body>
</html>
)rawliteral";

void onWsEvent(uint8_t client_num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
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
        // Pingメッセージをエコーバック
        Serial.printf("[WS] recv from %u: %s\n", client_num, (char *)payload);
        wsServer.sendTXT(client_num, payload, length);  // Pingエコー
        break;
      }
    default:
      break;
  }
}

void handleRoot() {
  httpServer.sendHeader("Content-Type", "text/html; charset=utf-8");
  httpServer.send(200, "text/html", index_html);
}

void setup() {
  Serial.begin(921600);
  Serial2.begin(230400, SERIAL_8N1, 25, 26);
  LD06_init(&ld06, LD06_onReceived);
  delay(100);

  Serial.println();
  Serial.println("ESP32 LiDAR System starting...");

  // WiFi接続（初回は待機）
  reconnectWiFi();

  // HTTP
  httpServer.on("/", handleRoot);
  httpServer.begin();
  Serial.println("HTTP server started on port 80");

  // WebSocket
  wsServer.begin();
  wsServer.onEvent(onWsEvent);
  Serial.println("WebSocket server started on port 81");
}

void loop() {
  static uint32_t lastServerControlTime = 0;

  uint32_t currentTime = millis();

  // WiFi接続チェック（定期的に確認）
  checkWiFiConnection();

  // LD06受信
  if (Serial2.available() > 0) {
    LD06_rxTask(&ld06, Serial2.read());
  }

  // サーバー制御
  if (currentTime >= lastServerControlTime + 10) {
    wsServer.loop();
    httpServer.handleClient();
    lastServerControlTime = currentTime;
  }
}

void LD06_onReceived(LD06 *lidar) {
  static int16_t lastDegree = -1;

  Serial.println("[LiDAR] Frame received");

  for (size_t i = 0; i < LD06_NUM_POINTS; i++) {
    float angle = lidar->angle[i];
    float distance = lidar->distance[i];

    int16_t degree = (int16_t)(angle / M_PI_F * 180.0f + 360.0f) % 360;

    // 周回検出
    if (degree < lastDegree) {
      sendLidarData();
    }

    LIDAR_DISTANCES[degree] = distance;

    lastDegree = degree;
  }
}

// バイナリLiDARデータを生成して送信
// フォーマット:
// [Header: 8 bytes]
//   - type: uint8_t (0x01 = LiDAR data)
//   - reserved: uint8_t (0x00)
//   - point_count: uint16_t (360)
//   - timestamp: uint32_t (milliseconds)
// [Data: 360 × 4 bytes]
//   - distance: float (meters) × 360 points
void sendLidarData() {
  static uint32_t lidarFrameCount = 0;

  // ヘッダー構築
  lidarDataBuf[0] = 0x01;  // type: LiDAR Data
  lidarDataBuf[1] = 0x00;  // reserved
  *((uint16_t *)(&lidarDataBuf[2])) = LIDAR_NUM_POINTS;
  *((uint32_t *)(&lidarDataBuf[4])) = millis();

  // バイナリデータをWebSocketで送信
  for (uint8_t i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
    if (wsServer.clientIsConnected(i)) {
      wsServer.sendBIN(i, lidarDataBuf, LIDAR_DATA_BUF_SIZE);
    }
  }

  lidarFrameCount++;
  Serial.printf("[LiDAR] Sent frame %u\n", lidarFrameCount);
}

// WiFi再接続処理
void reconnectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WiFi] Already connected");
    wifiRetryCount = 0;
    return;
  }

  Serial.printf("[WiFi] Connecting to '%s'... (attempt %d)\n", wifi_ssid, wifiRetryCount + 1);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifi_ssid, wifi_pass);

  unsigned long start = millis();
  int dots = 0;

  // 最大30秒待つ
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
    delay(500);
    Serial.print('.');
    dots++;
    if (dots % 60 == 0) Serial.println();
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    // 接続成功
    wifiRetryCount = 0;

    if (!MDNS.begin("esp32")) {
      Serial.println("[mDNS] Error starting mDNS");
    } else {
      Serial.println("[mDNS] Started successfully");
    }

    IPAddress myIP = WiFi.localIP();
    Serial.print("[WiFi] Connected! IP address: ");
    Serial.println(myIP);

  } else {
    // 接続失敗
    wifiRetryCount++;
    Serial.printf("[WiFi] Connection failed (retry count: %d)\n", wifiRetryCount);

    // 最大リトライ回数に達したらリセット
    if (wifiRetryCount >= WIFI_RESET_AFTER_RETRIES) {
      Serial.println("[WiFi] Max retries reached. Rebooting ESP32...");
      delay(1000);
      ESP.restart();
    }
  }
}

// WiFi接続状態を定期的にチェック
void checkWiFiConnection() {
  unsigned long currentTime = millis();

  // 定期チェック間隔
  if (currentTime - lastWifiCheck < WIFI_CHECK_INTERVAL) {
    return;
  }
  lastWifiCheck = currentTime;

  // WiFi切断検出
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Connection lost! Attempting to reconnect...");

    // WebSocketクライアントを切断
    for (uint8_t i = 0; i < WEBSOCKETS_SERVER_CLIENT_MAX; i++) {
      if (wsServer.clientIsConnected(i)) {
        wsServer.disconnect(i);
      }
    }

    // 再接続試行
    reconnectWiFi();

    // 再接続に失敗し、リトライ回数が上限に近い場合
    if (WiFi.status() != WL_CONNECTED && wifiRetryCount >= WIFI_MAX_RETRIES) {
      Serial.printf("[WiFi] Still disconnected after %d retries. Waiting %d ms before next attempt...\n",
                    wifiRetryCount, WIFI_RECONNECT_INTERVAL);
      delay(WIFI_RECONNECT_INTERVAL);
    }
  } else {
    // 接続中は定期的にログ出力
    if (wifiRetryCount > 0) {
      Serial.println("[WiFi] Connection stable. Resetting retry count.");
      wifiRetryCount = 0;
    }
  }
}