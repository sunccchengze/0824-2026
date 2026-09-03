#!/usr/bin/env bash
# 沙箱重建 NSS/NSPR 共享库（无头 Chromium 截图依赖）。
# 用法：bash scripts/rebuild-nss.sh
# 产物拷到 twin/nsslibs/（已在 .gitignore，不入库）。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/.nssbuild"
OUT="$ROOT/nsslibs"
mkdir -p "$BUILD" "$OUT"
cd "$BUILD"

echo "==> [1/4] 安装构建工具 (ninja/gyp)"
pip install --break-system-packages ninja gyp-next >/dev/null 2>&1 || pip install --break-system-packages ninja gyp-next

echo "==> [2/4] 获取 NSPR (sparse gecko-dev)"
if [ ! -d nspr ]; then
  git clone --filter=blob:none --sparse --depth 1 https://github.com/mozilla/gecko-dev.git gecko >/dev/null 2>&1
  ( cd gecko && git sparse-checkout set nsprpub >/dev/null 2>&1 )
  mv gecko/nsprpub nspr && rm -rf gecko
fi

echo "==> [3/4] 获取 NSS"
if [ ! -d nss ]; then
  curl -sSL -o nss.tar.gz https://codeload.github.com/nss-dev/nss/tar.gz/refs/heads/master
  tar xzf nss.tar.gz && mv nss-master nss && rm -f nss.tar.gz
fi

echo "==> [4/4] 编译（signtool 因缺 zlib 会报错，忽略；.so 全部产出）"
# 先清理旧 dist，避免残留
rm -rf "$BUILD/dist" || true
if [ -f nss/build.sh ]; then
  ( cd "$ROOT" && bash "$BUILD/nss/build.sh" -o --disable-tests >/tmp/nssbuild.log 2>&1 ) || true
else
  echo "!! nss/build.sh 不存在"; exit 1
fi

echo "==> 拷贝产物到 nsslibs/"
LIB="$BUILD/dist/Release/lib"
if [ -d "$LIB" ]; then
  cp -f "$LIB"/lib{nspr4,plc4,plds4,nss3,nssutil3,ssl3,smime3,freebl3,freeblpriv3,sqlite3}.so "$OUT"/ 2>/dev/null || true
else
  echo "!! 未找到 $LIB"; echo "--- build log tail ---"; tail -20 /tmp/nssbuild.log; exit 1
fi
echo "==> 完成，nsslibs 内容："
ls -la "$OUT" | grep '\.so' | head
