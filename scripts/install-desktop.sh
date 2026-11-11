#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS="$HOME/.local/share/applications"
TARGET="$APPS/memo-overlay.desktop"

mkdir -p "$APPS"

cat > "$TARGET" <<EOF
[Desktop Entry]
Type=Application
Name=速记
Name[en_US]=Memo Overlay
Comment=随时唤出的单页 Markdown 速记浮层
Comment[en_US]=A summon-anywhere single-page Markdown memo overlay
Exec=$DIR/scripts/run.sh
Icon=$DIR/assets/icon.png
Terminal=false
Categories=Utility;Office;
StartupWMClass=memo-overlay
EOF

chmod +x "$TARGET"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS" >/dev/null 2>&1 || true
fi

echo "已安装启动器：$TARGET"
