#!/usr/bin/env bash
#
# 把应用打包成自包含目录，并注册到开始菜单：
#   ~/.local/opt/memo-overlay/       Electron 运行时 + 应用资源
#   ~/.local/bin/memo-overlay        ELF 启动器（自动补 --no-sandbox）
#   ~/.local/share/applications/     开始菜单入口
#
# 用法：./scripts/package.sh
# 可用 PREFIX=/somewhere 改变安装前缀（要求 bin 与 opt 同级）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"
OPT="$PREFIX/opt/memo-overlay"
BIN="$PREFIX/bin"
APPS="$PREFIX/share/applications"
ICON_DIR="$PREFIX/share/icons/hicolor/256x256/apps"
ELECTRON_DIST="$ROOT/node_modules/electron/dist"

if [ ! -x "$ELECTRON_DIST/electron" ]; then
  echo "未找到 Electron，请先在 $ROOT 执行 npm install" >&2
  exit 1
fi

if ! command -v gcc >/dev/null 2>&1; then
  echo "需要 gcc 来编译启动器" >&2
  exit 1
fi

echo "[1/4] 复制 Electron 运行时..."
rm -rf "$OPT"
mkdir -p "$OPT"
cp -a "$ELECTRON_DIST/." "$OPT/"
if [ -f "$OPT/electron" ]; then
  mv "$OPT/electron" "$OPT/memo-overlay"
fi

echo "[2/4] 复制应用资源..."
APP="$OPT/resources/app"
mkdir -p "$APP"
cp "$ROOT/package.json" "$ROOT/main.js" "$ROOT/preload.js" "$APP/"
cp -a "$ROOT/src" "$APP/"
cp -a "$ROOT/assets" "$APP/"

echo "[3/4] 编译启动器..."
mkdir -p "$BIN"
gcc -O2 -Wall -o "$BIN/memo-overlay" "$ROOT/scripts/launcher.c"

echo "[4/4] 注册开始菜单入口..."
mkdir -p "$ICON_DIR" "$APPS"
cp "$ROOT/assets/icon.png" "$ICON_DIR/memo-overlay.png"

cat > "$APPS/memo-overlay.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=速记
Name[en_US]=Memo Overlay
GenericName=Markdown 速记浮层
Comment=随时唤出的单页 Markdown 速记浮层
Keywords=速记;备忘;备忘录;笔记;memo;markdown;note;
Exec=$BIN/memo-overlay %U
Icon=$ICON_DIR/memo-overlay.png
Terminal=false
Categories=Utility;
StartupNotify=true
StartupWMClass=memo-overlay
EOF
chmod +x "$APPS/memo-overlay.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS" >/dev/null 2>&1 || true
fi

echo
echo "完成。应用菜单搜索「速记 / memo」即可启动。"
echo "命令：$BIN/memo-overlay"
echo "安装目录：$OPT"
