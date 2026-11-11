#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$DIR/node_modules/electron/dist/electron"

if [ ! -x "$BIN" ]; then
  echo "未找到 Electron，请先在 $DIR 执行：npm install" >&2
  exit 1
fi

cd "$DIR"
exec "$BIN" "$DIR" --no-sandbox "$@"
