// ESP32 LiDAR WebSocket Binary Stream
// - HTTP server on port 80 serves the webpage
// - WebSocket server on port 81 sends binary LiDAR data at 10Hz
// - LiDAR data: 360 points (1 degree resolution), distance only

#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsServer.h>  // https://github.com/Links2004/arduinoWebSockets
#include "LD06.h"
#include "WebAssets.h"

// ----- 設定 -----
// APモード設定
const char *ap_ssid = "ESP32-LiDAR";
const char *ap_pass = "12345678";

WebServer httpServer(80);
WebSocketsServer wsServer(81);

// LiDARデータ送信用
#define LIDAR_NUM_POINTS 360
#define LIDAR_DATA_HEADER_SIZE 8
#define LIDAR_DATA_BUF_SIZE (LIDAR_DATA_HEADER_SIZE + LIDAR_NUM_POINTS * sizeof(float))
#define LIDAR_DISTANCES ((float *)(lidarDataBuf + LIDAR_DATA_HEADER_SIZE))

uint8_t lidarDataBuf[LIDAR_DATA_BUF_SIZE] = { 0 };

// 反射強度フィルタ（0-255）: この値未満のconfidenceはフィルタされる
#define DEFAULT_REFLECTION_THRESHOLD 50
uint8_t reflectionThreshold = DEFAULT_REFLECTION_THRESHOLD;

// LD06構造体
LD06 ld06;

void LD06_onReceived(LD06 *lidar);
void sendLidarData();
void setupAccessPoint();

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
        // payload は NULL 終端されていない可能性があるので安全にコピーして扱う
        char msg[128];
        size_t copyLen = length < sizeof(msg) - 1 ? length : sizeof(msg) - 1;
        memcpy(msg, payload, copyLen);
        msg[copyLen] = '\0';
        Serial.printf("[WS] recv from %u: %s\n", client_num, msg);

        // コマンド: THR:<0-255> で反射閾値を更新
        if ((strncmp(msg, "THR:", 4) == 0)) {
          long v = strtol(msg + 4, NULL, 10);
          if (v < 0)
            v = 0;
          if (v > 255)
            v = 255;
          reflectionThreshold = (uint8_t)v;
          char resp[64];
          snprintf(resp, sizeof(resp), "THR SET %u", reflectionThreshold);
          wsServer.sendTXT(client_num, (const uint8_t *)resp, strlen(resp));
          Serial.printf("[WS] reflectionThreshold updated to %u\n", reflectionThreshold);
        } else {
          // 通常はエコー
          wsServer.sendTXT(client_num, payload, length);  // Pingエコー
        }
        break;
      }
    default:
      break;
  }
}

void handleRoot() {
  httpServer.sendHeader("Content-Encoding", "gzip");
  httpServer.sendHeader("Cache-Control", "public, max-age=86400");
  httpServer.send_P(200, "text/html", (const char *)index_html_gz, index_html_gz_len);
}

void handleCSS() {
  httpServer.sendHeader("Content-Encoding", "gzip");
  httpServer.sendHeader("Cache-Control", "public, max-age=86400");
  httpServer.send_P(200, "text/css", (const char *)app_css_gz, app_css_gz_len);
}

void handleJS() {
  httpServer.sendHeader("Content-Encoding", "gzip");
  httpServer.sendHeader("Cache-Control", "public, max-age=86400");
  httpServer.send_P(200, "application/javascript", (const char *)app_js_gz, app_js_gz_len);
}

void handleFavicon() {
  httpServer.sendHeader("Content-Encoding", "gzip");
  httpServer.sendHeader("Cache-Control", "public, max-age=86400");
  httpServer.send_P(200, "image/svg+xml", (const char *)favicon_svg_gz, favicon_svg_gz_len);
}

void setup() {
  Serial.begin(921600);
  Serial2.begin(230400, SERIAL_8N1, 25, 26);
  LD06_init(&ld06, LD06_onReceived);
  delay(100);

  Serial.println();
  Serial.println("ESP32 LiDAR System starting...");

  // WiFi APモード起動
  setupAccessPoint();

  // HTTP
  httpServer.on("/", handleRoot);
  httpServer.on("/app.css", handleCSS);
  httpServer.on("/app.js", handleJS);
  httpServer.on("/favicon.svg", handleFavicon);
  httpServer.begin();
  Serial.println("HTTP server started on port 80");
  Serial.printf("Embedded assets: HTML=%u bytes, CSS=%u bytes, JS=%u bytes, Favicon=%u bytes\n",
                index_html_gz_len, app_css_gz_len, app_js_gz_len, favicon_svg_gz_len);

  // WebSocket
  wsServer.begin();
  wsServer.onEvent(onWsEvent);
  Serial.println("WebSocket server started on port 81");
}

void loop() {
  static uint32_t lastServerControlTime = 0;

  uint32_t currentTime = millis();

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
  static uint32_t _ld06_frame_counter = 0;
  _ld06_frame_counter++;

  for (size_t i = 0; i < LD06_NUM_POINTS; i++) {
    float angle = lidar->angle[i];
    float distance = lidar->distance[i];
    uint8_t confidence = lidar->confidence[i];

    int16_t degree = (int16_t)(angle / M_PI_F * 180.0f + 360.0f) % 360;

    // 周回検出
    if (degree < lastDegree) {
      sendLidarData();
    }

    // 反射強度フィルタ: confidence が閾値未満ならフィルタ（ここでは 0.0f を格納）
    if (confidence < reflectionThreshold) {
      LIDAR_DISTANCES[degree] = 0.0f;  // フィルタ済み（クライアント側で無視できるように 0 を送る）
    } else {
      LIDAR_DISTANCES[degree] = distance;
    }

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

// WiFi APモード起動
void setupAccessPoint() {
  Serial.printf("[WiFi] Starting Access Point '%s'...\n", ap_ssid);

  WiFi.mode(WIFI_AP);
  bool success = WiFi.softAP(ap_ssid, ap_pass);

  if (!success) {
    Serial.println("[WiFi] Failed to start Access Point!");
    delay(1000);
    ESP.restart();
  }

  delay(100);  // APモードの安定化待ち

  IPAddress myIP = WiFi.softAPIP();
  Serial.print("[WiFi] Access Point started! IP address: ");
  Serial.println(myIP);
  Serial.printf("[WiFi] SSID: %s\n", ap_ssid);
  Serial.printf("[WiFi] Password: %s\n", ap_pass);

  // mDNS設定（オプション）
  if (!MDNS.begin("esp32")) {
    Serial.println("[mDNS] Error starting mDNS");
  } else {
    Serial.println("[mDNS] Started successfully - http://esp32.local/");
  }
}