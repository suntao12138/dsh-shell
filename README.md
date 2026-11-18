# dsh-shell — a thin Linux desktop shell for dsh (DeepSeek Harness)

**English** | [简体中文](README.zh-CN.md)

A ~600-line Electron shell that reimplements **nothing**: it wraps the `dsh web` server you already
have installed into a native window. The upstream desktop build only targets macOS and Windows
([`apps/desktop/scripts/package-target.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/scripts/package-target.ts)
declares only `mac-arm64 / mac-x64 / win-x64`), so on Linux a thin shell is the cheapest option — and
it **reuses the dsh engine you installed with npm 100%**, along with everything in `~/.dsh`.

Upstream: <https://github.com/deepseek-ai/deepseek-harness>

## What it does

1. Locates the `dsh` CLI (`PATH` → `~/.nvm/versions/node/*/bin/dsh` → `/usr/local/bin`)
2. Spawns a `dsh web --no-open --host 127.0.0.1 --port <p>` process it owns, and reads the
   `dsh web: http://127.0.0.1:3080/?token=…` line it prints
3. Opens that tokenized URL in an Electron window (the frontend trades the token for a
   `dsh-auth-session` cookie)
4. When the cookie expires (the page turns into `authentication required`), it re-issues a token URL
5. Closing the window / quitting sends SIGTERM to `dsh web`; a crash triggers an automatic restart
   (up to 3 times)

All state lives in `~/.dsh`: profiles, sessions, credentials and plugins are shared with `dsh web`
on the command line.

## Install

### From the release

Grab the `.deb` from [Releases](https://github.com/suntao12138/dsh-shell/releases/latest):

```bash
sudo dpkg -i dsh-shell_*_amd64.deb     # uninstall: sudo dpkg --purge dsh-shell
```

The package ships the Electron runtime only — **the dsh engine is a prerequisite**:

```bash
npm install -g --registry=https://registry.npmjs.org/ @deepseek-ai/dsh@next
dsh --version
```

### From source

```bash
git clone https://github.com/suntao12138/dsh-shell.git
cd dsh-shell
npm install                 # then fetch the Electron binary manually:
node node_modules/electron/install.js    # (.npmrc allow-scripts blocks its postinstall)
./bin/dsh-shell                          # run it
./scripts/install-desktop.sh             # add to the app menu + ~/.local/bin/dsh-shell
```

Build the `.deb` (Electron runtime included under `/opt/dsh-shell`, engine not included):

```bash
./scripts/build-deb.sh                  # -> dist/dsh-shell_<ver>_amd64.deb
```

## Attach to a host that is already running

If `dsh web` is already running in a terminal, reuse its token instead of spawning a second host
(the token is the one it printed at startup):

```bash
DSH_SHELL_URL=http://127.0.0.1:3080/ DSH_SHELL_TOKEN=<printed token> ./bin/dsh-shell
```

## Menu and internationalization

### Structure (mirrors the upstream Linux branch)

Layout follows [`apps/desktop/src/main.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/main.ts#L1203-L1241):

- **Application**: `About DeepSeek Harness` (native About panel, `setAboutPanelOptions` parameters
  match upstream) → `Check for Updates…` → `Language` (added by this shell, see below) →
  `Reload Page` + `Restart App and Host` (only when unpackaged; upstream gates them on
  `!app.isPackaged`, and the deb launcher sets `DSH_SHELL_RELEASE=1` to behave as a release) →
  `Developer tools` (Ctrl+Shift+I) → `Quit`; plus the hidden `F12` alias (upstream's
  `devToolsF12Shortcut`).
- **Edit**: undo/redo · cut/copy/paste/delete · select all.
- Upstream has **no** View/Window menus on Linux and does **not** show "Manage dsh commands…" on
  Linux (that item is darwin/win32 only) — this shell does the same.
- The in-page context menu copies upstream
  [`main.ts:342-368`](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/main.ts#L342-L368):
  editable areas get undo/redo/cut/copy/paste/select-all disabled per `editFlags`, a non-editable
  selection gets Copy only, and `accelerator` is blanked so no shortcut text is rendered.

### i18n design (mixing languages is a hard constraint)

Upstream states the rule plainly in code: *"chrome and its content never mix languages"*
([`main.ts:471`](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/src/main.ts#L471)).
This shell implements the same idea:

1. **The dictionary is the contract**: `src/locales/<id>.js` holds one **complete** dictionary per
   language. `src/i18n.js` compares key sets at load time and throws if anything is missing
   (measured: removing `menu.devTools` → `i18n 词典键不齐 —— zh 缺: menu.devTools`), so a
   half-translated menu is structurally impossible. Adding a language = copy a dictionary, fill it
   in, add it to `SUPPORTED_IDS`. Today: `zh` + `en` (the engine's own built-ins are the same two;
   its other six locales are plugin extensions that fall back to English).
2. **Resolution chain** (highest priority first): `DSH_SHELL_LOCALE` (debug override, this run only,
   never persisted) → the language picked in the menu (`mode=fixed`, persisted) →
   **follow the app language** (`mode=auto`, reads `document.documentElement.lang`) → preferred
   system languages (`app.getPreferredSystemLanguages()`, same as upstream's `systemLanguages`) →
   `en` (the engine's `FALLBACK_LOCALE`). Locale ids resolve by their BCP-47 primary subtag
   (`zh-CN` → `zh`), matching upstream's `resolveDesktopLocale`.
3. **Follow the app language**: the engine's `syncDocumentLanguage()` writes `zh-CN` for
   `active==='zh'` and the raw id otherwise, driven by the Host setting `locale.preference`
   (dsh → Settings → General → Language). Upstream's desktop gets that change over a preload IPC
   (`dsh-desktop:locale-changed`); this shell loads `dsh web` over HTTP and has no such bridge, so
   it polls `document.documentElement.lang` every 2 s (`DSH_SHELL_LANG_POLL_MS`). Measured: after
   flipping the page language to `en`, the menu switched from 「应用/编辑 + 撤销/重做…」 to
   「Application/Edit + Undo/Redo…」 within 1.5 s, with `source: "page"`.
4. **Persistence**: `<userData>/desktop/locale-cache` (locale id) and `locale-mode`
   (`auto`/`fixed`), same paths and permissions (700/600) as upstream's `locale-cache.ts`. A new
   process restores the pinned choice (`source: "pinned"`).
5. **Language menu**: `Application → Language` → radio `中文` / `English` (using the engine's own
   picker labels from `BUILT_IN_LOCALE_METADATA`), plus a `Follow the app language` checkbox.
   Selecting rebuilds the menu immediately — upstream's `localeChanged` handler also does
   `writeDesktopLocaleCache` + `refreshApplicationMenu`. Language names stay self-described
   (中文 / English), which is normal for a language picker and not "mixed language".

**Why the Edit menu is hand-built instead of Electron's `{role:'editMenu'}`**: on Linux Electron
does not translate built-in role labels (measured: the menu bar renders `Edit`, and `--lang=zh-CN`
does not change it), so the built-in menu is guaranteed to mix languages. Following upstream's own
`macEditMenu` precedent (it also re-lists the menu to control its labels), every item gets an
explicit label.

**Where the strings come from** (annotated key by key in the dictionaries): menu items and role
labels come from upstream's desktop `locale.ts` zh dictionary; `编辑`, `语言` and `确定` come from
the engine's own dictionaries (`common.edit`, `settings.locale language.title`, `common.ok`). Only
two strings are mine: `Follow the app language` and the update-check dialog body (upstream's version
checks its own installer, a channel this shell does not have).

Inspect the menu tree and the language decision (add `--user-data-dir` when another instance is
running, to bypass the single-instance lock):

```bash
DSH_SHELL_DUMP_MENU=1 ./bin/dsh-shell
# with another instance running:
DSH_SHELL_DUMP_MENU=1 node_modules/.bin/electron --no-sandbox --user-data-dir=/tmp/probe .
```

## Sandbox

Chromium's SUID sandbox helper must be `root:4755`. In a source checkout `chrome-sandbox` has plain
permissions, so `bin/dsh-shell` detects that and passes `--no-sandbox` (calling `appendSwitch` in JS
is too late — the sandbox is already initialised). The `.deb` `postinst` fixes the ownership and
mode under `/opt`, so an installed build keeps the sandbox.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DSH_BIN` | auto-detected | Path to the dsh CLI |
| `DSH_SHELL_HOST` | `127.0.0.1` | Bind address |
| `DSH_SHELL_PORT` | `3080` | Preferred port; falls back to an OS-assigned port when busy |
| `DSH_SHELL_URL` | — | Attach to a running host instead of spawning one |
| `DSH_SHELL_TOKEN` | — | Token used with `DSH_SHELL_URL` |
| `DSH_HOME` | `~/.dsh` | Passed through to the dsh child process |
| `DSH_SHELL_LOCALE` | — | Force the menu language for this run (`zh`/`en`), debug only |
| `DSH_SHELL_LANG_POLL_MS` | `2000` | Poll interval for "follow the app language" |
| `DSH_SHELL_DUMP_MENU` | off | Print the language decision + menu tree, then exit |
| `DSH_SHELL_RELEASE` | set to 1 by the deb launcher | Behave as a release build (hide dev-only items) |

## Self-checks

```bash
./bin/dsh-shell --smoke --smoke-out /tmp/dsh-shell-smoke.png   # prints JSON: ok/url/title/png/first-screen text

# Language-follow check: flips the page lang to en; the JSON gains a langTest field
DSH_SHELL_LANG_SELFTEST=1 DSH_SHELL_LANG_POLL_MS=1500 \
  ./bin/dsh-shell --smoke --smoke-out /tmp/dsh-shell-lang.png
```

The `.deb` can be verified without installing it: `dpkg-deb -x dist/*.deb <dir>` and run
`<dir>/opt/dsh-shell/electron/electron --no-sandbox <dir>/opt/dsh-shell/app --smoke --smoke-out …`.

## Files

- `main.js` — everything (host supervision + window + auth retry + lifecycle + menus)
- `src/i18n.js` — dictionary registry, resolution chain, persistence, key-set validation
- `src/locales/zh.js`, `src/locales/en.js` — complete dictionaries (each string annotated with its source)
- `bin/dsh-shell` — launcher (adds nvm's PATH; GUI launches get a very sparse PATH)
- `scripts/install-desktop.sh` / `uninstall-desktop.sh` — per-user desktop registration
- `scripts/build-deb.sh` — builds the `.deb` (Depends derived from `ldd` + `dpkg -S`)
- Log: `~/.config/dsh-shell/server.log`; window state: `window-state.json`

## Known limits

- **One host per `~/.dsh`**: when `dsh web` is already on 3080 this shell picks another port, but two
  hosts sharing the same data is unsupported — pick one.
- The first run may need a login (dsh recreates `~/.dsh` when it is empty): sign in once in the
  window and the CLI shares those credentials afterwards.
- Upstream's auto-update targets its own installer; this shell has no installer channel, so
  `Check for Updates…` inspects the engine instead (`npm view @deepseek-ai/dsh dist-tags`, taking the
  higher of `next`/`latest`) and shows the update command. Tray support and OS integration (zenity
  folder pickers etc.) remain out of scope.
