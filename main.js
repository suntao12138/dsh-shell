#!/usr/bin/env node
/*
 * dsh-shell — Linux thin-shell client for the dsh (DeepSeek Harness) Web UI.
 *
 * It does NOT reimplement any dsh logic. It:
 *   1. locates your installed `dsh` CLI,
 *   2. owns a local `dsh web` host process (shares your ~/.dsh data),
 *   3. opens that host in a native window and keeps the auth cookie fresh,
 *   4. stops the host when the window closes.
 *
 * Env overrides:
 *   DSH_BIN           path to the dsh CLI (default: PATH / newest nvm install)
 *   DSH_SHELL_HOST    bind address            (default 127.0.0.1)
 *   DSH_SHELL_PORT    preferred port          (default 3080, falls back to a free one)
 *   DSH_SHELL_URL     attach to an already-running host instead of starting one
 *   DSH_SHELL_TOKEN   auth token for DSH_SHELL_URL
 *   DSH_HOME          forwarded as-is; default ~/.dsh (your existing data)
 */
'use strict'

const { app, BrowserWindow, Menu, shell, dialog } = require('electron')
const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const net_mod = require('node:net')
const path = require('node:path')

const i18n = require('./src/i18n')

const APP_NAME = 'dsh-shell'
const PRODUCT_NAME = 'DeepSeek Harness'
const HOST = process.env.DSH_SHELL_HOST || '127.0.0.1'
const PREFERRED_PORT = Number.parseInt(process.env.DSH_SHELL_PORT || '3080', 10)
const SMOKE = process.argv.includes('--smoke')
const SMOKE_OUT = (() => {
  const i = process.argv.indexOf('--smoke-out')
  return i > -1 ? path.resolve(process.argv[i + 1]) : path.join(app.getPath('temp'), 'dsh-shell-smoke.png')
})()
const SMOKE_WAIT = Number.parseInt(process.env.DSH_SHELL_SMOKE_WAIT || '6000', 10)

const STATE_DIR = path.join(app.getPath('userData'))
const WINDOW_STATE_FILE = path.join(STATE_DIR, 'window-state.json')
const SERVER_LOG_FILE = path.join(STATE_DIR, 'server.log')
const MAX_AUTO_RESTARTS = 3

app.setName(APP_NAME)
try { app.setDesktopName(APP_NAME) } catch {}
if (SMOKE) app.commandLine.appendSwitch('no-sandbox')

// ---------------------------------------------------------------- dsh lookup

function findDshBinary() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const candidates = []
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'dsh'))
  }
  // nvm installs are the usual home of the dsh CLI; newest version wins.
  try {
    const roots = [path.join(app.getPath('home'), '.nvm', 'versions', 'node')]
    for (const root of roots) {
      for (const entry of fs.readdirSync(root)) {
        candidates.push(path.join(root, entry, 'bin', 'dsh'))
      }
    }
  } catch {}
  candidates.push('/usr/local/bin/dsh', '/usr/bin/dsh')
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return null
}

function portIsBusy(port) {
  return new Promise((resolve) => {
    const socket = new net_mod.Socket()
    socket.setTimeout(600)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
    socket.connect(port, HOST)
  })
}

// ---------------------------------------------------------------- host child

const server = {
  child: null,
  tokenUrl: null,
  baseUrl: null,
  restarts: 0,
  stopping: false,
  log(chunk) {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true })
      fs.appendFileSync(SERVER_LOG_FILE, `[${new Date().toISOString()}] ${chunk}`)
    } catch {}
  },
  async start() {
    if (process.env.DSH_SHELL_URL) {
      this.baseUrl = new URL(process.env.DSH_SHELL_URL).origin
      this.tokenUrl = process.env.DSH_SHELL_TOKEN
        ? `${this.baseUrl}/?token=${encodeToken(process.env.DSH_SHELL_TOKEN)}`
        : `${this.baseUrl}/`
      this.log(`attach mode: ${this.baseUrl}\n`)
      return this.tokenUrl
    }

    const bin = findDshBinary()
    if (!bin) throw new Error(`找不到 dsh CLI（可用 DSH_BIN 指定路径）`)

    let port = PREFERRED_PORT
    if (port && await portIsBusy(port)) {
      this.log(`port ${port} 已被占用，改由系统分配端口\n`)
      port = 0
    }

    const args = ['web', '--no-open', '--host', HOST, '--port', String(port || 0)]

    this.log(`spawn: ${bin} ${args.join(' ')}\n`)
    const child = spawn(bin, args, {
      env: { ...process.env, DSH_SHELL_MANAGED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child

    child.stdout.on('data', (buf) => {
      const text = buf.toString()
      this.log(text)
      const match = /dsh web:\s+(https?:\/\/\S+)/.exec(text)
      if (match && !this.tokenUrl) {
        this.tokenUrl = match[1]
        this.baseUrl = new URL(this.tokenUrl).origin
        this.emitUrl?.()
      }
    })
    child.stderr.on('data', (buf) => this.log(buf.toString()))

    child.on('exit', (code, signal) => {
      this.log(`host exit code=${code} signal=${signal}\n`)
      this.child = null
      this.tokenUrl = null
      this.baseUrl = null
      if (this.stopping) return
      this.onCrash?.(code, signal)
    })

    // The launcher prints the token URL once the host is listening.
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 dsh web 启动超时（30s），详见 server.log')), 30_000)
      this.emitUrl = () => { clearTimeout(timer); resolve(this.tokenUrl) }
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        reject(new Error(`dsh web 启动失败（exit=${code} signal=${signal}），详见 ${SERVER_LOG_FILE}`))
      })
    })
  },
  stop() {
    this.stopping = true
    const child = this.child
    if (!child) return
    try { child.kill('SIGTERM') } catch {}
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5000)
    child.once('exit', () => clearTimeout(timer))
  },
}

function encodeToken(value) {
  try { return encodeURIComponent(value) } catch { return value }
}

// ---------------------------------------------------------------- window

let win = null

function readWindowState() {
  try { return JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8')) } catch { return {} }
}

function saveWindowState() {
  if (!win) return
  try {
    const bounds = win.getBounds()
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify({ ...bounds, maximized: win.isMaximized() }))
  } catch {}
}

function iconPath() {
  const p = path.join(__dirname, 'assets', 'icon.png')
  return fs.existsSync(p) ? p : undefined
}

// ------------------------------------------------------------------ update check
// 上游的「检查更新」查的是它自己的安装包；本壳没有安装包通道，语义映射为查引擎版本。
function compareVersions(a, b) {
  const split = (value) => {
    const [main, pre] = String(value).split('-', 2)
    return { nums: main.split('.').map((part) => parseInt(part, 10) || 0), pre: pre ? pre.split('.') : [] }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < 3; i += 1) {
    if ((x.nums[i] || 0) !== (y.nums[i] || 0)) return (x.nums[i] || 0) > (y.nums[i] || 0) ? 1 : -1
  }
  if (!x.pre.length && !y.pre.length) return 0
  if (!x.pre.length) return 1
  if (!y.pre.length) return -1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const np = /^\d+$/.test(p) ? Number(p) : null
    const nq = /^\d+$/.test(q) ? Number(q) : null
    if (np !== null && nq !== null) {
      if (np !== nq) return np > nq ? 1 : -1
    } else if (p !== q) {
      return p > q ? 1 : -1
    }
  }
  return 0
}

function runCapture(exe, args) {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: 30000 }, (error, stdout) => resolve(error ? null : String(stdout).trim()))
  })
}

async function checkForUpdates() {
  const messages = i18n.messages()
  const okButton = [messages.update.ok]
  const dshBin = findDshBinary()
  const failure = () => dialog.showMessageBox(win || undefined, {
    type: 'warning', title: messages.menu.checkUpdates, message: messages.update.failed, buttons: okButton,
  })
  if (!dshBin) {
    await failure()
    return
  }
  const npmBin = ['npm', 'npm.cmd'].map((name) => path.join(path.dirname(dshBin), name)).find((f) => fs.existsSync(f))
  const [tagsRaw, current] = await Promise.all([
    npmBin ? runCapture(npmBin, ['view', '@deepseek-ai/dsh', 'dist-tags', '--json']) : Promise.resolve(null),
    runCapture(dshBin, ['--version']),
  ])
  let tags = null
  try { tags = JSON.parse(tagsRaw) } catch { tags = null }
  if (!tags || !current) {
    await failure()
    return
  }
  const candidate = [tags.next, tags.latest].filter(Boolean).sort((a, b) => compareVersions(b, a))[0]
  const fresh = !candidate || compareVersions(candidate, current) <= 0
  await dialog.showMessageBox(win || undefined, {
    type: 'info',
    title: messages.menu.checkUpdates,
    message: fresh
      ? i18n.format(messages.update.upToDate, { version: current })
      : i18n.format(messages.update.available, { current, candidate }),
    detail: messages.update.detail,
    buttons: okButton,
  })
}

// ------------------------------------------------------------------ menu
// 结构抄上游 apps/desktop/src/main.ts:1203-1241 的 Linux 分支（「应用」+ 编辑，无 视图/窗口，
// 「管理 dsh 命令…」只给 darwin/win32，开发期两项由 !app.isPackaged 门控，F12 为隐藏别名）。
// 差别：编辑子菜单不是用 Electron 内置 { role: 'editMenu' }，而是照上游 macEditMenu 的做法
// 自己列一遍并给每项显式标签 —— Linux 上 Electron 不翻译内置 role，用内置必然半中半英。
function editMenuItems(messages) {
  return [
    { label: messages.roles.undo, role: 'undo' },
    { label: messages.roles.redo, role: 'redo' },
    { type: 'separator' },
    { label: messages.roles.cut, role: 'cut' },
    { label: messages.roles.copy, role: 'copy' },
    { label: messages.roles.paste, role: 'paste' },
    { label: messages.roles.delete, role: 'delete' },
    { type: 'separator' },
    { label: messages.roles.selectAll, role: 'selectAll' },
  ]
}

// 语言菜单：单选某一种语言（落盘固定），或回到“跟随界面语言”。
// 上游没有这个菜单（它的语言由 web 端设置唯一决定，桌面端被动跟随）；本壳加它是因为
// dsh web 的语言设置在窗口里，用户想改外壳菜单时不必去翻 web 设置。
function languageMenuItems(messages) {
  const state = i18n.debugState()
  return [
    ...i18n.supported().map((locale) => ({
      label: locale.displayName,
      type: 'radio',
      checked: state.mode === 'fixed' && state.pinned === locale.id,
      click: () => {
        i18n.pin(locale.id)
        refreshApplicationMenu()
      },
    })),
    { type: 'separator' },
    {
      label: messages.menu.languageFollow,
      type: 'checkbox',
      checked: state.mode === 'auto',
      click: () => {
        i18n.follow()
        refreshApplicationMenu()
      },
    },
  ]
}

function restartAppAndHost() {
  if (server.stopping) return
  app.relaunch()
  app.quit()
}

function refreshApplicationMenu() {
  const messages = i18n.messages()
  // 上游 development = !app.isPackaged；deb 里跑的是裸 electron，同样会被判为开发态，
  // 所以打包脚本置 DSH_SHELL_RELEASE=1 让它回到发布态（隐藏开发期两项）。
  const development = !app.isPackaged && !process.env.DSH_SHELL_RELEASE
  const devToolsF12Shortcut = { role: 'toggleDevTools', visible: false, accelerator: 'F12' }

  const applicationItems = () => [
    { label: messages.menu.about, role: 'about' },
    { type: 'separator' },
    { label: messages.menu.checkUpdates, click: () => { void checkForUpdates() } },
    { label: messages.menu.language, submenu: languageMenuItems(messages) },
    { type: 'separator' },
    ...(development
      ? [
        { label: messages.menu.reload, role: 'reload' },
        { label: messages.menu.restartAppHost, click: restartAppAndHost },
      ]
      : []),
    { label: messages.menu.devTools, role: 'toggleDevTools' },
    { type: 'separator' },
    { label: messages.menu.quit, role: 'quit' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: messages.menu.application, submenu: [...applicationItems(), devToolsF12Shortcut] },
    { label: messages.menu.edit, submenu: editMenuItems(messages) },
  ]))
}

// 跟随界面语言：读引擎维护的 document.documentElement.lang。
// 引擎 syncDocumentLanguage() 把 active==='zh' 写成 'zh-CN'、其余写语言 id，
// 而 active 由 Host 设置 locale.preference（设置 → 通用 → 语言）驱动。
// 上游桌面端靠 preload 的 dsh-desktop:locale-changed 推送；本壳加载 http 上的 web，
// 没有那条 bridge，所以用短周期轮询代替推送。
let languageTimer = null
const LANG_POLL_MS = Math.max(500, Number(process.env.DSH_SHELL_LANG_POLL_MS) || 2000)

function armLanguageWatcher(target) {
  if (languageTimer) clearInterval(languageTimer)
  languageTimer = setInterval(async () => {
    if (!target || target.isDestroyed()) return
    let lang = null
    try {
      lang = await target.webContents.executeJavaScript('document.documentElement.lang || ""', true)
    } catch {
      return // 正在导航/还没加载完，下一轮再读
    }
    if (i18n.notePageLang(lang)) refreshApplicationMenu()
  }, LANG_POLL_MS)
  target.once('closed', () => {
    if (languageTimer) clearInterval(languageTimer)
    languageTimer = null
  })
}

function sameOrigin(urlString) {
  try {
    return server.baseUrl && new URL(urlString).origin === new URL(server.baseUrl).origin
  } catch { return false }
}

function createWindow() {
  const saved = readWindowState()
  win = new BrowserWindow({
    width: saved.width || 1440,
    height: saved.height || 900,
    x: Number.isInteger(saved.x) ? saved.x : undefined,
    y: Number.isInteger(saved.y) ? saved.y : undefined,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: PRODUCT_NAME,
    icon: iconPath(),
    backgroundColor: '#151517',
    autoHideMenuBar: false,
    webPreferences: {
      spellcheck: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (saved.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  for (const event of ['resize', 'move', 'close']) win.on(event, saveWindowState)

  // External links go to the system browser; the window stays on the dsh host.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !sameOrigin(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // 右键「编辑」菜单：抄上游 apps/desktop/src/main.ts:342-368。
  // 可编辑区给完整编辑项并按 editFlags 置灰；非编辑区有选区时只给复制；
  // accelerator 置空是为了不显示 Electron 默认的快捷键文字。
  win.webContents.on('context-menu', (_event, { isEditable, selectionText, editFlags }) => {
    const roles = i18n.messages().roles
    const items = []
    if (isEditable) {
      items.push(
        { label: roles.undo, role: 'undo', enabled: editFlags.canUndo },
        { label: roles.redo, role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { label: roles.cut, role: 'cut', enabled: editFlags.canCut },
        { label: roles.copy, role: 'copy', enabled: editFlags.canCopy },
        { label: roles.paste, role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { label: roles.selectAll, role: 'selectAll', enabled: editFlags.canSelectAll },
      )
    } else if (selectionText.length > 0) {
      items.push({ label: roles.copy, role: 'copy', enabled: editFlags.canCopy })
    }
    if (items.length === 0) return
    Menu.buildFromTemplate(items.map((item) => ({ ...item, accelerator: '' }))).popup({ window: win })
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url) && !url.startsWith('data:')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // A stale/rotated session cookie comes back as the host's plain-text 401 document:
  // reload through the token URL so the host re-issues the cookie (throttled).
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(
      "document.body ? document.body.innerText.trim().slice(0,300) : ''", true
    ).then((text) => {
      if (typeof text !== 'string' || !text.includes('authentication required')) return
      if (!server.tokenUrl || Date.now() - lastAuthReload < 5000) return
      lastAuthReload = Date.now()
      loadApp()
    }).catch(() => {})
  })

  armLanguageWatcher(win)

  win.on('closed', () => { win = null })
  return win
}

let lastAuthReload = 0

async function loadApp() {
  if (!win) return
  const target = server.tokenUrl || server.baseUrl
  if (!target) return
  await win.loadURL(target)
}

function showError(message) {
  const startup = i18n.messages().startup
  const detail = `${message}\n\n${i18n.format(startup.logLabel, { path: SERVER_LOG_FILE })}`
  if (SMOKE) {
    console.log(JSON.stringify({ ok: false, error: message }))
    app.exit(1)
    return
  }
  const choice = dialog.showMessageBoxSync(win || undefined, {
    type: 'error',
    title: startup.title,
    message: startup.failed,
    detail,
    buttons: [startup.retry, startup.quit],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice === 0) boot()
  else app.quit()
}

async function boot() {
  try {
    await server.start()
  } catch (error) {
    showError(error.message)
    return
  }
  await loadApp()
}

// ---------------------------------------------------------------- lifecycle

server.onCrash = () => {
  if (SMOKE) { showError('dsh web 进程意外退出'); return }
  if (server.restarts >= MAX_AUTO_RESTARTS) {
    showError(i18n.format(i18n.messages().startup.crashLoop, { count: MAX_AUTO_RESTARTS }))
    return
  }
  server.restarts += 1
  setTimeout(async () => {
    if (server.stopping) return
    await boot()
  }, 1500)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.on('before-quit', () => server.stop())

  app.whenReady().then(() => {
    i18n.init({
      userDataDir: app.getPath('userData'),
      systemLanguages: app.getPreferredSystemLanguages(),
      envLocale: process.env.DSH_SHELL_LOCALE || null,
    })
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
      applicationVersion: app.getVersion(),
      // 同上游：发布版无独立 build 号，省掉 Electron 的 bundle 版本
      version: '',
      copyright: '',
      iconPath: iconPath(),
    })
    refreshApplicationMenu()

    // 测试钩子：DSH_SHELL_DUMP_MENU=1 时打印菜单树后退出（不启动引擎/窗口）
    if (process.env.DSH_SHELL_DUMP_MENU) {
      const dump = (item) => ({
        label: item.label, role: item.role, accelerator: item.accelerator,
        visible: item.visible,
        ...(item.submenu ? { submenu: item.submenu.items.map(dump) } : {}),
      })
      console.log(JSON.stringify(i18n.debugState()))
      console.log(JSON.stringify(Menu.getApplicationMenu().items.map(dump), null, 1))
      app.exit(0)
      return
    }

    createWindow()
    boot().then(() => {
      if (!SMOKE) return
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage()
          fs.mkdirSync(path.dirname(SMOKE_OUT), { recursive: true })
          fs.writeFileSync(SMOKE_OUT, image.toPNG())
          const text = await win.webContents.executeJavaScript(
            "document.body ? document.body.innerText.slice(0,600) : ''", true
          )
          // 语言跟随自检：把页面 lang 改成 en，看外壳菜单是否同步换语言
          let langTest = null
          if (process.env.DSH_SHELL_LANG_SELFTEST) {
            const snapshot = () => ({
              state: i18n.debugState(),
              labels: Menu.getApplicationMenu().items.map((item) => item.label),
              editItems: Menu.getApplicationMenu().items[1].submenu.items.map((item) => item.label).filter(Boolean),
            })
            const before = snapshot()
            await win.webContents.executeJavaScript('document.documentElement.lang = "en"', true)
            await new Promise((resolve) => setTimeout(resolve, LANG_POLL_MS + 1200))
            const after = snapshot()
            i18n.notePageLang(null) // 复原，免得测试结束后又被轮询改回去影响后续断言
            langTest = { before, after }
          }
          console.log(JSON.stringify({
            ok: !String(text).includes('authentication required'),
            url: win.webContents.getURL(),
            title: win.getTitle(),
            png: SMOKE_OUT,
            text: String(text).replace(/\s+/g, ' ').slice(0, 200),
            ...(langTest ? { langTest } : {}),
          }))
        } catch (error) {
          console.log(JSON.stringify({ ok: false, error: String(error && error.message || error) }))
        } finally {
          // app.exit() skips before-quit, so close the host down explicitly.
          server.stop()
          setTimeout(() => app.exit(0), 800)
        }
      }, SMOKE_WAIT)
    })
  })

  app.on('window-all-closed', () => app.quit())
}
