# ESP32内蔵Webアセット技術解説

## 概要

このドキュメントでは、ESP32マイコン内にWebアプリケーション（HTML/CSS/JavaScript）を埋め込み、完全オフラインで動作させる技術について詳しく解説します。

## 背景と目的

### 従来の方法（外部ホスティング）

```html
<!-- 外部CDNからリソースを読み込み -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/user/repo@main/app.css">
<script src="https://raw.githubusercontent.com/user/repo/main/app.js"></script>
```

**問題点：**
- インターネット接続が必須
- 外部サーバーのダウンタイムに依存
- レイテンシが発生
- WiFi環境がない場所で使用不可

### 新しい方法（ESP32内蔵）

ESP32のフラッシュメモリにWebアセットを保存し、内蔵HTTPサーバーから配信。

**利点：**
- 完全オフライン動作
- 高速レスポンス
- 外部依存なし
- 独立したシステム

---

## 技術的アプローチ

### アーキテクチャ概要

```
┌─────────────────────────────────────┐
│         ブラウザ (クライアント)       │
│  - HTML/CSS/JSをリクエスト           │
│  - WebSocket接続でLiDARデータ受信    │
└──────────────┬──────────────────────┘
               │ HTTP/WebSocket
               │ (WiFi経由)
┌──────────────▼──────────────────────┐
│           ESP32 (APモード)           │
│  ┌──────────────────────────────┐   │
│  │   HTTPサーバー (Port 80)      │   │
│  │  - /            → index.html  │   │
│  │  - /app.css     → CSS (gzip)  │   │
│  │  - /app.js      → JS (gzip)   │   │
│  │  - /favicon.svg → Icon (gzip) │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ WebSocketサーバー (Port 81)   │   │
│  │  - LiDARデータのストリーミング │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │   フラッシュメモリ内蔵データ  │   │
│  │  - app.css.gz     (1.1 KB)   │   │
│  │  - app.js.gz      (185 KB)   │   │
│  │  - favicon.svg.gz (0.2 KB)   │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

## 実装手順

### 1. アセットの準備とビルド

Webアプリケーションをビルドして最適化されたファイルを生成：

```bash
cd gui
npm run build
# 出力: dist/app.css, dist/app.js
```

### 2. gzip圧縮

ファイルサイズを削減するためにgzip圧縮を実行：

```bash
cd gui/dist
gzip -9 -c app.js > app.js.gz    # 690KB → 185KB (73%削減)
gzip -9 -c app.css > app.css.gz  # 2.9KB → 1.1KB (62%削減)
```

**圧縮率の例：**
| ファイル | 元サイズ | 圧縮後 | 削減率 |
|---------|---------|--------|--------|
| app.js  | 690 KB  | 185 KB | 73%    |
| app.css | 2.9 KB  | 1.1 KB | 62%    |

### 3. バイナリデータの16進配列変換

統合されたPythonスクリプト（`tools/embed_assets.py`）を使用してgzipファイルをC言語の配列に変換：

```python
#!/usr/bin/env python3
"""
ESP32 Web Assets Embedding Tool
CSS/JS/Faviconをgzip圧縮してESP32用ヘッダーファイルに変換
"""

import gzip
import os
import sys

def compress_file(file_path):
    """ファイルをgzip圧縮"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    return gzip.compress(content.encode('utf-8'), compresslevel=9)

def write_array(f, name, data, description):
    """C配列を出力"""
    f.write(f'\n// {description}\n')
    f.write(f'const uint32_t {name}_len = {len(data)};\n')
    f.write(f'const uint8_t {name}[] PROGMEM = {{\n  ')

    for i, byte in enumerate(data):
        f.write(f'0x{byte:02x}')
        if i < len(data) - 1:
            f.write(',')
            if (i + 1) % 16 == 0:
                f.write('\n  ')
            else:
                f.write(' ')

    f.write('\n};\n')

def main():
    # CSS/JS/Faviconを圧縮
    css_gz = compress_file('gui/dist/app.css')
    js_gz = compress_file('gui/dist/app.js')
    favicon_gz = compress_file('gui/public/favicon.svg')

    # WebAssets.hを生成
    with open( (自動生成)
#ifndef WEB_ASSETS_H
#define WEB_ASSETS_H

#include <Arduino.h>

// CSS (gzip compressed)
const uint32_t app_css_gz_len = 1115;
const uint8_t app_css_gz[] PROGMEM = {
  0x1f, 0x8b, 0x08, 0x08, 0x98, 0x1e, 0x48, 0x69, 0x02, 0x03, 0x61, 0x70,
  // ... 残りのデータ
};

// JavaScript (gzip compressed)
const uint32_t app_js_gz_len = 188758;
const uint8_t app_js_gz[] PROGMEM = {
  0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0xec, 0xbd,
  // ... 残りのデータ
};

// Favicon SVG (gzip compressed)
const uint32_t favicon_svg_gz_len = 233;
const uint8_t favicon_svg_gz[] PROGMEM = {
  0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0x3c, 0x73

```cpp
// WebAssets.h
#ifndef WEB_ASSETS_H
#define WEB_ASSETS_H

#include <Arduino.h>

// CSS データ (gzip圧縮済み)
const uint32_t app_css_gz_len = 1115;
const uint8_t app_css_gz[] PROGMEM = {
  0x1f, 0x8b, 0x08, 0x08, 0x98, 0x1e, 0x48, 0x69, 0x02, 0x03, 0x61, 0x70,
  0x70, 0x2e, 0x63, 0x73, 0x73, 0x00, 0xb5, 0x56, 0xb1, 0x6e, 0xeb, 0x36,
  // ... 残りのデータ
};

// JavaScript データ (gzip圧縮済み)
const uint32_t app_js_gz_len = 188758;
const uint8_t app_js_gz[] PROGMEM = {
  0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0xec, 0xbd,
  // ... 残りのデータ
};

#endif
```

### 4. ESP32コードへの統合

#### 4.1 ヘッダーファイルのインクルード

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include "WebAssets.h"  // 生成されたアセット
```

#### 4.2 HTMLの更新

外部URLをローカルパスに変更：

```cpp Piano</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg"
const char index_html[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <title>LiDARピアノ</title>
    <link rel="stylesheet" href="/app.css">
</head>
<body>
    <div id="root"></div>
    <script src="/app.js"></script>
</body>
</html>
)rawliteral";
```

#### 4.3 HTTPハンドラの実装

```cpp
WebServer httpServer(80);

// ルートページ
void handleRoot() {
  httpServer.sendHeader("Content-Type", "text/html; charset=utf-8");
  httpServer.send(200, "text/html", index_html);
}

// CSSファイル (gzip圧縮)
void handleCSS() {
  httpServer.sendHeader("Content-Encoding", "gzip");
  httpServer.sendHeader("Cache-Control", "public, max-age=86400");
  httpServer.send_P(200, "text/css",
                    (const char *)app_css_gz,
                    app_css_gz_len);
}

// JavaScriptファイル (gzip圧縮)
void handleJS() {
  httpServer.sendHeader("Content-Encoding", "gzip");
  httpServer.sendHeader("Cache-Control", "public, max-age=86400");
  httpServer.send_P(200, "application/javascript",
                    (const char *)app_js_gz,
                    app_js_gz_len);
}
// Faviconファイル (gzip圧縮)
void handleFavicon() {
  httpServer.sendHeader("Content-Encoding", "gzip");
  httpServer.sendHeader("Cache-Control", "public, max-age=86400");
  httpServer.send_P(200, "image/svg+xml",
                    (const char *)favicon_svg_gz,
                    favicon_svg_gz_len);
}

void setup() {
  // WiFi APモード設定
  WiFi.mode(WIFI_AP);
  WiFi.softAP("ESP32-LiDAR", "12345678");

  // ルート設定
  httpServer.on("/", handleRoot);
  httpServer.on("/app.css", handleCSS);
  httpServer.on("/app.js", handleJS);
  httpServer.on("/favicon.svg", handleFaviconSS);
  httpServer.on("/app.js", handleJS);

  httpServer.begin();
  Serial.println("HTTP server started");
}
```

---

## データ圧縮とメモリ管理

### PROGMEM修飾子

ESP32のフラッシュメモリに配列を保存するために`PROGMEM`を使用：

```cpp
const uint8_t app_js_gz[] PROGMEM = { /* data */ };
```

**メモリ配置：**
- `PROGMEM`なし → RAM（貴重で限られている）
- `PROGMEM`あり → Flash（大容量で読み取り専用）

### send_P()メソッド

フラッシュメモリから直接データを送信：

```cpp
// send_P() = "send from Program memory"
httpServer.send_P(200, "text/css",
                  (const char *)app_css_gz,  // PROGMEMからの読み取り
                  app_css_gz_len);
```

### メモリ使用量

```
ESP32メモリ構成:
┌─────────────────────────────┐
│  Flash (4MB)                │
│  - プログラムコード          │
│  - app.css.gz (1.1 KB)      │ ← PROGMEM
│  - app.js.gz (185 KB)       │ ← PROGMEM
└─────────────────────────────┘
┌─────────────────────────────┐
│  RAM (520KB)                │
│  - 動的メモリ                │
│  - スタック                  │
│  - グローバル変数            │
└─────────────────────────────┘
```

---

## HTTPサーバー実装

### HTTPヘッダーの重要性

#### Content-Encoding: gzip

ブラウザに圧縮データであることを通知：

```cpp
httpServer.sendHeader("Content-Encoding", "gzip");
```

ブラウザは自動的に解凍して表示します。

#### Cache-Control

キャッシュを有効化してパフォーマンス向上：

```cpp
httpServer.sendHeader("Cache-Control", "public, max-age=86400");
// max-age=86400 → 24時間キャッシュ
```

**効果：**
- 初回アクセス：185KB + 1.1KB = 186KB転送
- 2回目以降：キャッシュから読み込み、転送なし

### MIMEタイプの指定

正しいContent-Typeを設定：

```cpp
// プロジェクト構造
AichiProgrammingContest2025-HardwareCategory/
├── tools/
│   └── embed_assets.py          # 統合アセット埋め込みツール
├── build_and_embed.sh            # 自動ビルド&埋め込みスクリプト
├── esp32_app/
│   ├── esp32_app.ino            # ESP32メインプログラム
│   ├── LD06.h / LD06.c          # LiDARドライバ
│   └── WebAssets.h              # 自動生成アセット (編集不可)
├── gui/
│   ├── src/                      # React/TypeScriptソース
│   ├── public/
│   │   └── favicon.svg          # ファビコン
│   ├── dist/                     # ビルド出力
│   │   ├── app.js
│   │   └── app.css
│   ├── package.json
│   └── vite.config.js           # 最適化設定
└── docs/
    └── ESP32_Embedded_Web_Assets.md
```

---

## 自動化ワークフロー

統合ビルドスクリプト
```bash
# 実行権限を付与（初回のみ）
chmod +x build_and_embed.sh

# ビルド&埋め込みを実行
./build_and_embed.sh
```