#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [ ! -d "node_modules" ]; then
    echo "[Error] node_modules 不存在，请先运行 ./scripts/setup.sh"
    exit 1
fi

echo "====================================="
echo "  Multi-Agent Server"
echo "====================================="
echo ""
echo "启动后会自动打开浏览器进行元宝网页授权。"
echo "请在浏览器窗口中扫描二维码完成登录。"
echo "授权成功后，API 将立即可用。"
echo ""

node src/server.js "$@"
