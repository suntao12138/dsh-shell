#!/usr/bin/env bash
# Build an installable .deb for the thin shell: app files + the Electron binary
# distribution it already downloaded, installed under /opt/dsh-shell.
#
#   ./scripts/build-deb.sh            -> dist/dsh-shell_<version>_amd64.deb
#   sudo dpkg -i dist/dsh-shell_*.deb
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

VERSION="$(node -e 'console.log(require("./package.json").version)')"
case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64) ARCH=arm64 ;;
  *) ARCH="$(uname -m)" ;;
esac

ELECTRON_DIST="$APP_DIR/node_modules/electron/dist"
[ -d "$ELECTRON_DIST" ] || { echo "缺少 $ELECTRON_DIST —— 先执行 npm install"; exit 1; }

STAGE="$APP_DIR/dist/deb-root"
PKG="dsh-shell_${VERSION}_${ARCH}.deb"
rm -rf "$STAGE"
mkdir -p "$STAGE/opt/dsh-shell/app" "$STAGE/DEBIAN" "$STAGE/usr/bin" \
         "$STAGE/usr/share/applications"

# --- payload ---------------------------------------------------------------
# 桌面项图标用圆角磁贴版（四角透明），与 install-desktop.sh 保持一致
ICON_REL="assets/icon-windows.png"
[ -f "$APP_DIR/$ICON_REL" ] || ICON_REL="assets/icon.png"

cp "$APP_DIR/main.js" "$APP_DIR/package.json" "$STAGE/opt/dsh-shell/app/"
cp -r "$APP_DIR/src" "$STAGE/opt/dsh-shell/app/src"
cp -r "$APP_DIR/assets" "$STAGE/opt/dsh-shell/app/assets"
cp -r "$ELECTRON_DIST" "$STAGE/opt/dsh-shell/electron"
# 图标用桌面项里的绝对路径，不进图标主题目录（不碰 /usr/share/icons/hicolor）
cat > "$STAGE/usr/share/applications/dsh-shell.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=DeepSeek Harness
GenericName=DeepSeek Harness
Comment=本地 dsh Web 界面的桌面外壳（复用已安装的 dsh CLI 与 ~/.dsh 数据）
Exec=dsh-shell %U
Icon=/opt/dsh-shell/app/$ICON_REL
Terminal=false
Categories=Development;
StartupWMClass=dsh-shell
Keywords=dsh;deepseek;harness;agent;
EOF

cat > "$STAGE/usr/bin/dsh-shell" <<'EOF'
#!/bin/sh
# GUI launchers inherit a minimal PATH; the dsh CLI lives in the nvm bin dirs.
for bin in "$HOME"/.nvm/versions/node/*/bin /usr/local/bin /usr/bin; do
  [ -d "$bin" ] && PATH="$bin:$PATH"
done
export PATH
: "${DSH_SHELL_PORT:=3080}"
export DSH_SHELL_PORT
# 安装版按发布态出菜单（不显示 刷新页面 / 重启应用与 Host）
export DSH_SHELL_RELEASE=1
exec /opt/dsh-shell/electron/electron /opt/dsh-shell/app "$@"
EOF
chmod 755 "$STAGE/usr/bin/dsh-shell"
chmod 644 "$STAGE/usr/share/applications/dsh-shell.desktop"

# --- Electron sandbox helper needs the SUID bit when run as an installed app
if [ -f "$STAGE/opt/dsh-shell/electron/chrome-sandbox" ]; then
  cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
chmod 4755 /opt/dsh-shell/electron/chrome-sandbox 2>/dev/null || true
chmod 755 /opt/dsh-shell/electron/electron
update-desktop-database /usr/share/applications 2>/dev/null || true
EOF
  chmod 755 "$STAGE/DEBIAN/postinst"
fi

# --- control: derive Depends from the Electron binary's own shared libraries
map_libs() {
  ldd "$STAGE/opt/dsh-shell/electron/electron" 2>/dev/null \
    | awk '{ if ($1 ~ /^\//) print $1; else print $1 }' \
    | grep -E '\.so' \
    | while read -r lib; do
        key="$lib"
        [ "${lib#/}" = "$lib" ] && key="/usr/lib/$(uname -m)-linux-gnu/$lib"
        dpkg -S "$key" 2>/dev/null | head -1 | cut -d: -f1
      done | grep -E '^lib[a-z0-9+._-]+$' | sort -u
}

DEPENDS="$(map_libs | tr '\n' ',' | sed 's/,$//')"
[ -n "$DEPENDS" ] || DEPENDS="libgtk-3-0, libnss3, libgbm1, libasound2"

SIZE_KB="$(du -sk "$STAGE" | cut -f1)"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: dsh-shell
Version: $VERSION
Architecture: $ARCH
Maintainer: Sun Tao <suntao12138@example.invalid>
Installed-Size: $SIZE_KB
Priority: optional
Section: utils
Depends: $DEPENDS
Description: DeepSeek Harness 桌面薄壳（Linux）
 用 Electron 窗口承载本机 dsh web 界面：自动启动/停止 dsh web 进程，
 直接复用已安装的 dsh CLI 与 ~/.dsh 里的 profile、会话和凭据，
 不重复打包 dsh 引擎。
EOF

mkdir -p "$APP_DIR/dist"
dpkg-deb --root-owner-group --build "$STAGE" "$APP_DIR/dist/$PKG" >/dev/null
rm -rf "$STAGE"

echo "已生成：dist/$PKG"
ls -lh "$APP_DIR/dist/$PKG" | awk '{print "大小：", $5}'
echo "安装：sudo dpkg -i dist/$PKG"
