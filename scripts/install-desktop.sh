#!/usr/bin/env bash
# Register dsh-shell in the desktop session: launcher on PATH + app menu entry + icon.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$APP_DIR/bin/dsh-shell"
# 用上游的圆角磁贴版（四角透明，深/浅主题都不糊边）；绝对路径不经图标主题查找
ICON_SRC="$APP_DIR/assets/icon-windows.png"
[ -f "$ICON_SRC" ] || ICON_SRC="$APP_DIR/assets/icon.png"
DESKTOP_DIR="$HOME/.local/share/applications"

chmod +x "$BIN"

mkdir -p "$HOME/.local/bin" "$DESKTOP_DIR"
ln -sf "$BIN" "$HOME/.local/bin/dsh-shell"

# 图标只用桌面项里的绝对路径（Icon=$ICON_SRC），不往图标主题目录里放东西。
# 教训：在 ~/.local/share/icons/hicolor 下生成 index.theme 会**顶掉系统的 hicolor 主题定义**
# （用户目录优先级更高），系统那份登记了几百个目录、我们只登记十几个，
# 结果全站图标都查不到、全变成齿轮。绝对路径不需要主题查找，也不影响任何其它应用。

cat > "$DESKTOP_DIR/dsh-shell.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=DeepSeek Harness
GenericName=DeepSeek Harness
Comment=本地 dsh Web 界面的桌面外壳（复用已安装的 dsh CLI 与 ~/.dsh 数据）
Exec=$BIN %U
Icon=$ICON_SRC
Terminal=false
Categories=Development;
StartupWMClass=dsh-shell
Keywords=dsh;deepseek;harness;agent;
EOF

update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

# 用户自建 .desktop 必须是可执行 + 可信，否则文件管理器/启动器按未信任处理，
# 直接显示 application-x-executable 的齿轮而不读 Icon=（这是"图标取不到"的真凶）。
chmod +x "$DESKTOP_DIR/dsh-shell.desktop"
gio set "$DESKTOP_DIR/dsh-shell.desktop" metadata::trusted true 2>/dev/null || true

echo "已注册："
echo "  启动器  $HOME/.local/bin/dsh-shell"
echo "  应用项  $DESKTOP_DIR/dsh-shell.desktop（Icon=$ICON_SRC）"
echo "  图标    绝对路径，不经主题查找（不写 ~/.local/share/icons）"
echo "卸载：$APP_DIR/scripts/uninstall-desktop.sh"
