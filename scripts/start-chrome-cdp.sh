#!/bin/bash
# 启动本地 Chrome 并开启远程调试端口 (CDP)
# 这样 multi-agent 可以通过 CDP 直接连接，复用登录态，无需扫码

CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -f "$CHROME_BIN" ]; then
    echo "[Error] 未找到 Google Chrome: $CHROME_BIN"
    echo "[Tip] 如果你使用的是 Chromium，请修改本脚本中的 CHROME_BIN 路径"
    exit 1
fi

echo "[StartChrome] 正在强制关闭现有 Chrome 进程..."
killall -9 "Google Chrome" 2>/dev/null || true
sleep 3

echo "[StartChrome] 正在启动 Chrome (远程调试端口 127.0.0.1:9222)..."
echo "[StartChrome] 启动后请手动打开 https://yuanbao.tencent.com 并确保已登录"
echo ""

# 使用 nohup 放到后台，明确绑定 127.0.0.1 避免 IPv6 问题
nohup "$CHROME_BIN" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-default-browser-check \
  > /dev/null 2>&1 &

CHROME_PID=$!

# 循环等待 CDP 端口可用，最多等 20 秒
echo -n "[StartChrome] 等待 CDP 服务就绪"
for i in {1..20}; do
  if curl -sf http://127.0.0.1:9222/json/version | grep -q "Browser"; then
    echo ""
    echo "[StartChrome] Chrome 已启动，CDP 地址: http://127.0.0.1:9222"
    echo "[StartChrome] 现在可以运行: npm run chat 或 ./scripts/start.sh"
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "[Error] Chrome CDP 端口 9222 未在 20 秒内就绪"
echo "[Tip] 请检查是否有其他进程占用了 9222 端口"
echo "[Tip] 也可以尝试手动启动: \"$CHROME_BIN\" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1"
exit 1
