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

## 自動化ワークフロー

統合ビルドスクリプト
```bash
# 実行権限を付与（初回のみ）
chmod +x build_and_embed.sh

# ビルド&埋め込みを実行
./build_and_embed.sh
```