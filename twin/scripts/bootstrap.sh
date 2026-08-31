#!/usr/bin/env bash
# AEOLUS 沙箱一键恢复脚本（2026-08-31 起为权威方式）
# 用途：沙箱重置后，恢复 node_modules + 无头Chromium 所需的 NSS/NSPR/libnspr 桩库 + 触发 /tmp/chromium 解压。
# 用法：bash twin/scripts/bootstrap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TWIN="$ROOT/twin"

echo "[1/3] npm install (twin)"
cd "$TWIN"
npm install --no-audit --no-fund

echo "[2/3] 构建 /tmp/nsslibs 桩库（NSS/NSPR/SECMOD）"
NSS_SRC="$TWIN/scripts/nss_stub.c"
NSS_MAP="$TWIN/scripts/nss_version.map"
mkdir -p /tmp/nsslibs
for so in libnspr4.so libnss3.so libnssutil3.so; do
  gcc -shared -fPIC -O2 -o "/tmp/nsslibs/$so" "$NSS_SRC" \
    -Wl,--version-script="$NSS_MAP" -Wl,-soname,"$so"
  echo "  built /tmp/nsslibs/$so"
done
export LD_LIBRARY_PATH=/tmp/nsslibs

echo "[3/3] 触发 /tmp/chromium 解压（如需）"
node -e "import('@sparticuz/chromium').then(async m=>{console.log('chromium:', await m.default.executablePath())})"

echo "OK. 启动 dev:  cd $TWIN && npm run dev -- --host 0.0.0.0"
