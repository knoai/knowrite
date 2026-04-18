#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "[Setup] 安装 Node 依赖..."
npm install --cache ./.npm-cache

echo "[Setup] 初始化完成！"
echo "[Setup] 可运行 ./scripts/start.sh 启动服务"
echo "[Setup] 提示: 若本地未安装 Chrome，可手动执行 npx playwright install chromium"
