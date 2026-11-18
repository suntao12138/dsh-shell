# dsh-shell — dsh（DeepSeek Harness）Linux 桌面薄壳

[English](README.md) | **简体中文**

一份 ~600 行的 Electron 外壳：**不重写任何 dsh 逻辑**，只把本机已安装的 `dsh web` 装进一个原生窗口。
上游桌面端只打包 macOS / Windows
（[`apps/desktop/scripts/package-target.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/scripts/package-target.ts)
里只有 `mac-arm64 / mac-x64 / win-x64`），所以 Linux 客户端用薄壳方式最省 —— 而且**100% 复用你 npm 装的那套 dsh 引擎**，
profile、会话、凭据、插件全部走同一份 `~/.dsh`。

上游仓库：<https://github.com/deepseek-ai/deepseek-harness>

## 它做什么

1. 找 `dsh` CLI（`PATH` → `~/.nvm/versions/node/*/bin/dsh` → `/usr/local/bin`）
2. 启动一个由自己托管的 `dsh web --no-open --host 127.0.0.1 --port <p>` 进程，
   读取它打印的 `dsh web: http://127.0.0.1:3080/?token=…`
3. 用 Electron 窗口打开这个带 token 的 URL（前端把 token 换成 `dsh-auth-session` cookie）
4. cookie 失效（页面出现 `authentication required`）就用 token URL 重新换发
5. 窗口关闭 / 退出 → SIGTERM 关停 dsh web；崩溃自动重启（最多 3 次）

## 安装

### 用打包好的 deb

从 [Releases](https://github.com/suntao12138/dsh-shell/releases/latest) 取最新的 `.deb`：

```bash
sudo dpkg -i dsh-shell_*_amd64.deb     # 卸载：sudo dpkg --purge dsh-shell
```

包里只有 Electron 运行时 —— **dsh 引擎是前置条件**，需要自己装：

```bash
npm install -g --registry=https://registry.npmjs.org/ @deepseek-ai/dsh@next
dsh --version
```

### 从源码

```bash
git clone https://github.com/suntao12138/dsh-shell.git
cd dsh-shell
npm install                              # 之后需要手动补 Electron 二进制：
node node_modules/electron/install.js     #（.npmrc 的 allow-scripts 白名单会拦 postinstall）
./bin/dsh-shell                           # 直接跑
./scripts/install-desktop.sh              # 注册到应用菜单 + ~/.local/bin/dsh-shell
```

打 `.deb`（把 Electron 二进制一起打包进 `/opt/dsh-shell`，不打包 dsh 引擎）：

```bash
./scripts/build-deb.sh                   # -> dist/dsh-shell_<ver>_amd64.deb
```

## 连已在运行的 host（不再新起进程）

命令行里已经 `dsh web` 跑着时，用它的 token 直接接（token 就是它启动时打印的那串）：

```bash
DSH_SHELL_URL=http://127.0.0.1:3080/ DSH_SHELL_TOKEN=<host 打印的 token> ./bin/dsh-shell
```

## 菜单与国际化

### 结构（照上游 Linux 分支）

结构取自上游
[`apps/desktop/src/main.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/main.ts#L1203-L1241)：

- **应用**：`关于 DeepSeek Harness`（原生 About 面板，`setAboutPanelOptions` 参数同上游）
  → `检查更新…` → `语言`（本壳新增，见下） → `刷新页面` + `重启应用与 Host`（仅未打包时出现，
  上游用 `!app.isPackaged` 门控；deb 启动器置 `DSH_SHELL_RELEASE=1` 回到发布态）
  → `开发者工具`（Ctrl+Shift+I） → `退出`；另有隐藏别名 F12（上游 `devToolsF12Shortcut`）
- **编辑**：撤销/重做 · 剪切/复制/粘贴/删除 · 全选
- 上游 Linux **没有** 视图/窗口 菜单，也 **不给 Linux 显示**「管理 dsh 命令…」（只给 darwin/win32），
  这里同样不加。
- 网页里的右键菜单抄上游
  [`main.ts:342-368`](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/main.ts#L342-L368)：
  可编辑区给 撤销/重做/剪切/复制/粘贴/全选 并按 `editFlags` 置灰；非编辑区有选区时只给 复制；
  `accelerator` 置空所以不带快捷键文字。

### 国际化设计（不混语言是硬约束）

上游的原则在代码注释里写得很直白：*"chrome and its content never mix languages"*
（[`main.ts:471`](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/main.ts#L471)）。
本壳按同样思路实现：

1. **词典即契约**：`src/locales/<id>.js`，每种语言一份**完整**词典。`src/i18n.js` 在加载时做键集合
   全等校验，少一个键就直接抛错退出（实测：删掉 `menu.devTools` → `i18n 词典键不齐 —— zh 缺: menu.devTools`），
   所以半中半英在结构上不可能出现。新增语言 = 拷一份词典补全 + 加进 `SUPPORTED_IDS`。
   目前 `zh` + `en`（引擎自己的 built-in 也只有这两种，其余 6 种是插件带 fallback 的扩展）。
2. **解析链**（高优先级在前）：`DSH_SHELL_LOCALE`（调试用，本次强制、不落盘）
   → 用户在语言菜单里点死的（`mode=fixed`，落盘）
   → **跟随界面语言**（`mode=auto`，读页面 `document.documentElement.lang`）
   → 系统首选语言（`app.getPreferredSystemLanguages()`，同上游 `systemLanguages`）
   → `en`（引擎的 `FALLBACK_LOCALE`）。
   语言 id 按 BCP-47 主语言段解析（`zh-CN` → `zh`），同上游 `resolveDesktopLocale`。
3. **跟随界面语言**：引擎的 `syncDocumentLanguage()` 把 `active==='zh'` 写成 `zh-CN`、其余写语言 id，
   而 `active` 由 Host 设置 `locale.preference`（dsh 的 设置 → 通用 → 语言）驱动。
   上游桌面端靠 preload 的 `dsh-desktop:locale-changed` 拿到这个变化；本壳加载的是 http 上的 dsh web，
   没有那条 bridge，所以按 2 秒轮询读 `document.documentElement.lang`（`DSH_SHELL_LANG_POLL_MS` 可调）。
   实测：把页面 lang 改成 `en`，菜单在 1.5s 内从「应用/编辑 + 撤销/重做…」变成「Application/Edit + Undo/Redo…」，
   判据里 `source: "page"`。
4. **持久化**：`<userData>/desktop/locale-cache`（语言 id）和 `locale-mode`（`auto`/`fixed`），
   路径与格式对齐上游 `locale-cache.ts`（权限 700/600）。重启进程后 `source: "pinned"` 会恢复。
5. **语言菜单**：`应用 → 语言` → 单选 `中文` / `English`（用引擎语言选择器自己的 label：
   `BUILT_IN_LOCALE_METADATA`），下面一条 `跟随界面语言` 勾选框。选完立即重建菜单（上游 `localeChanged`
   也是 `writeDesktopLocaleCache` + `refreshApplicationMenu`）。语言名保持各语言自称（中文/English），
   这是语言选择器的通行做法，不算混语言。

**为什么要自己列编辑菜单而不是用 Electron 内置 `{role:'editMenu'}`**：Linux 上 Electron 不翻译内置
role 的文字（实测菜单条渲染成 `Edit`，`--lang=zh-CN` 也不改），用内置必然混语言。所以照上游
`macEditMenu` 的先例（它为了给 Mac 补文案也是自己列一遍）显式给每项标签。

**文案来源**（词典文件里逐条注明）：菜单项和 role 标签用上游桌面 `locale.ts` 的 zh 词典
（`应用/关于…/检查更新…/刷新页面/重启应用与 Host/开发者工具/退出/撤销/重做/剪切/复制/粘贴/删除/全选`）；
`编辑`、`语言`、`确定` 用引擎自己词典里的 `common.edit`、`settings.locale language.title`、`common.ok`；
只有 2 处是我写的：`跟随界面语言` 和更新检查对话框正文（上游那个功能查的是它自己的安装包，薄壳没有这个通道）。

查菜单树和语言判定（另有实例在跑时加 `--user-data-dir` 绕开单实例锁）：

```bash
DSH_SHELL_DUMP_MENU=1 ./bin/dsh-shell
# 另开一个实例时：
DSH_SHELL_DUMP_MENU=1 node_modules/.bin/electron --no-sandbox --user-data-dir=/tmp/probe .
```

## 沙箱

Chromium 的 SUID 沙箱助手必须 `root:4755`。源码目录里的 `chrome-sandbox` 是普通权限，
所以 `bin/dsh-shell` 会自动检测并补 `--no-sandbox`（JS 里 `appendSwitch` 太晚，进程已经起沙箱）。
`.deb` 装到 `/opt` 后 `postinst` 会把权限设好，届时沙箱自动保留。

## 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `DSH_BIN` | 自动查找 | 指定 dsh CLI 路径 |
| `DSH_SHELL_HOST` | `127.0.0.1` | 绑定地址 |
| `DSH_SHELL_PORT` | `3080` | 首选端口；被占用时自动让系统分配 |
| `DSH_SHELL_URL` | — | 不启动新进程，直接连已在运行的 host |
| `DSH_SHELL_TOKEN` | — | 配合 `DSH_SHELL_URL` 的 token |
| `DSH_HOME` | `~/.dsh` | 传给 dsh 子进程（原样透传） |
| `DSH_SHELL_LOCALE` | — | 本次运行强制菜单语言（`zh`/`en`），调试用、不落盘 |
| `DSH_SHELL_LANG_POLL_MS` | `2000` | 「跟随界面语言」读页面 lang 的周期 |
| `DSH_SHELL_DUMP_MENU` | 关 | 打印语言判定 + 菜单树后退出（自检用） |
| `DSH_SHELL_RELEASE` | deb 启动器置 1 | 按发布态出菜单（隐藏开发期两项） |

## 自检

```bash
./bin/dsh-shell --smoke --smoke-out /tmp/dsh-shell-smoke.png   # 打印 JSON：ok/url/title/png/首屏文本

# 语言跟随自检：把页面 lang 改成 en，菜单应同步换语言（JSON 里带 langTest）
DSH_SHELL_LANG_SELFTEST=1 DSH_SHELL_LANG_POLL_MS=1500 \
  ./bin/dsh-shell --smoke --smoke-out /tmp/dsh-shell-lang.png
```

deb 不装系统也能验证：`dpkg-deb -x dist/*.deb <dir>` 后跑
`<dir>/opt/dsh-shell/electron/electron --no-sandbox <dir>/opt/dsh-shell/app --smoke --smoke-out …`。

## 文件

- `main.js` — 全部逻辑（host 托管 + 窗口 + 鉴权重试 + 生命周期 + 菜单）
- `src/i18n.js` — 词典注册表、解析链、持久化、键集合校验
- `src/locales/zh.js`、`src/locales/en.js` — 完整词典（含逐条文案来源注释）
- `bin/dsh-shell` — 启动器（补 nvm 的 PATH，GUI 启动时 PATH 很干净）
- `scripts/install-desktop.sh` / `uninstall-desktop.sh` — 用户级桌面注册
- `scripts/build-deb.sh` — 生成 .deb（Depends 由 `ldd` + `dpkg -S` 自动推导）
- 日志：`~/.config/dsh-shell/server.log`，窗口状态：`window-state.json`

## 已知边界

- **一个 `~/.dsh` 同时只应有一个 host**：命令行 `dsh web` 已在 3080 跑着时，本壳会自动换端口，
  但两个 host 共用同一份数据并不受支持——二选一。
- 首次运行需要登录（`~/.dsh` 被清空后 `dsh` 会重建目录）：在窗口里登录一次即可，
  命令行 `dsh` 随后共享同一份凭据。
- 上游的自动更新是给它的安装包用的；薄壳没有安装包通道，`检查更新…` 改为查引擎
  （`npm view @deepseek-ai/dsh dist-tags`，取 `next`/`latest` 里较大者）并给出更新命令。
  托盘、系统集成（zenity 目录选择等）仍不在薄壳范围内。
