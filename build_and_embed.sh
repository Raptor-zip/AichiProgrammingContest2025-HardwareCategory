#!/bin/bash
# ESP32 Web Assets Build & Embed Script
# ビルド → 圧縮 → 埋め込み を自動実行

set -e  # エラーで停止

# 色付き出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  ESP32 LiDAR Piano - Build & Embed${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Step 1: Web アプリケーションのビルド
echo -e "\n${YELLOW}[1/2]${NC} Building web application..."
cd gui
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Build completed"

# Step 2: アセットの埋め込み
echo -e "\n${YELLOW}[2/2]${NC} Embedding assets into ESP32..."
cd ..
python3 tools/embed_assets.py

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Embedding failed!${NC}"
    exit 1
fi

# 完了メッセージ
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ All done! Ready to flash ESP32${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "\n📝 WebAssets.h size: $(du -h esp32_app/WebAssets.h | cut -f1)"
echo -e "🚀 Next: Upload to ESP32 via Arduino IDE\n"