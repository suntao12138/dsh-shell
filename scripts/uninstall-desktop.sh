#!/usr/bin/env bash
# Remove the desktop registration created by install-desktop.sh (keeps the app and its data).
set -euo pipefail

rm -f "$HOME/.local/bin/dsh-shell"
rm -f "$HOME/.local/share/applications/dsh-shell.desktop"
for s in 48x48 128x128 256x256 512x512 1024x1024; do
  rm -f "$HOME/.local/share/icons/hicolor/$s/apps/dsh-shell.png"
done
rm -f "$HOME/.local/share/icons/hicolor/scalable/apps/dsh-shell.svg"
gtk-update-icon-cache -q -t -f "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "已移除启动器与应用项。"
echo "应用本体：$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "配置/日志：~/.config/dsh-shell   会话数据（dsh 自身）：~/.dsh"
