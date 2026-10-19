#!/bin/bash
set -eu
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo '需要既有 Node.js 20 或更新版本。未安裝任何軟體；請回報 Control Plane。'
  read -r -p '按 Enter 關閉。' _answer
  exit 1
fi
if ! node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'; then
  echo '既有 Node.js 版本太舊。未安裝或下載任何軟體；請回報 Control Plane。'
  read -r -p '按 Enter 關閉。' _answer
  exit 1
fi
exec node local-preview/launch.mjs
