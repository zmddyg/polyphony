#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22 或更高版本后再启动联机课堂服务。"
  echo "单机离线演示可直接用浏览器打开仓库根目录的「共演演示室.html」。"
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "当前 Node.js 版本为 $(node -v)，共演需要 Node.js 22 或更高版本。"
  exit 1
fi

exec node server.mjs --open "$@"
