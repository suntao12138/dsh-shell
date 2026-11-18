// 外壳自身的 i18n。设计对齐上游桌面端（apps/desktop/src/{locale.ts,locale-cache.ts,main.ts}）
// 和引擎的 locale 运行时（@deepseek-ai/dsh-client-locale）：
//
//   * 词典按 BCP-47 主语言段解析（zh-CN → zh），查不到回落 en —— 同上游
//     resolveDesktopLocale 和引擎的 FALLBACK_LOCALE='en'；
//   * 词典键集合在加载时做全等校验，缺键直接抛错，所以**不可能**出现半中半英的菜单；
//   * 用户确认过语言就写 <userData>/desktop/locale-cache（上游 locale-cache.ts 同一路径、同一格式）；
//   * 语言一变就重建应用菜单（上游 main.ts:896 的 localeChanged 也是 writeDesktopLocaleCache + refreshApplicationMenu）。
//
// 与上游的唯一差别是信号来源：上游桌面端用 preload 的 IPC（dsh-desktop:locale-changed）拿到 web 的语言；
// 本壳加载的是 http://127.0.0.1 上的 dsh web，没有那条 bridge。改用引擎自己维护的
// document.documentElement.lang —— 引擎 syncDocumentLanguage() 把 active==='zh' 写成 'zh-CN'、
// 其余写语言 id，且它由 Host 设置 locale.preference 驱动（设置 → 通用 → 语言）。
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const FALLBACK = 'en'
const SUPPORTED_IDS = ['zh', 'en']

const dictionaries = new Map()
for (const id of SUPPORTED_IDS) {
  const dict = require(`./locales/${id}`)
  if (dict.id !== id) throw new Error(`i18n: ${id}.js 里的 id 是 ${dict.id}`)
  dictionaries.set(id, dict)
}

// 键集合全等校验：新增语言 / 新增文案时，漏翻译会在启动时直接失败，而不是运行时半英半中
function keyTree(value, prefix = '') {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.keys(value).flatMap((key) => keyTree(value[key], prefix ? `${prefix}.${key}` : key))
}
function assertKeyParity() {
  const base = keyTree(dictionaries.get(FALLBACK)).sort()
  const problems = []
  for (const [id, dict] of dictionaries) {
    if (id === FALLBACK) continue
    const keys = keyTree(dict).sort()
    const missing = base.filter((k) => !keys.includes(k))
    const extra = keys.filter((k) => !base.includes(k))
    if (missing.length) problems.push(`${id} 缺: ${missing.join(', ')}`)
    if (extra.length) problems.push(`${id} 多: ${extra.join(', ')}`)
  }
  if (problems.length) throw new Error(`i18n 词典键不齐 —— ${problems.join('；')}`)
}
assertKeyParity()

const state = {
  mode: 'auto',            // auto = 跟随界面语言；fixed = 用户在菜单里点死的
  pinned: null,            // mode=fixed 时的语言 id
  pageLang: null,          // document.documentElement.lang（引擎同步）
  envLocale: null,         // DSH_SHELL_LOCALE：本次运行强制，不落盘
  systemIds: [],           // 系统语言（已解析成 id，去重）
  userDataDir: null,
}

function cacheDir() {
  return state.userDataDir ? path.join(state.userDataDir, 'desktop') : null
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim() } catch { return '' }
}

function writeText(file, value) {
  const dir = path.dirname(file)
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, `${value}\n`, { mode: 0o600 })
  } catch (error) {
    console.warn(`i18n: 写入 ${file} 失败`, error)
  }
}

// 上游 resolveDesktopLocale：取主语言段，命中词典用它，否则回落 en
function resolveId(raw) {
  const primary = String(raw || '').toLowerCase().split('-')[0]
  return dictionaries.has(primary) ? primary : FALLBACK
}

function dedupe(ids) {
  const seen = []
  for (const id of ids) if (!seen.includes(id)) seen.push(id)
  return seen
}

function init({ userDataDir, systemLanguages = [], envLocale = null }) {
  state.userDataDir = userDataDir || null
  state.envLocale = envLocale || null
  state.systemIds = dedupe(systemLanguages.map(resolveId).filter((id) => dictionaries.has(id)))
  if (!state.systemIds.length) state.systemIds = [FALLBACK]

  const dir = cacheDir()
  if (dir) {
    const mode = readText(path.join(dir, 'locale-mode'))
    if (mode === 'fixed' || mode === 'auto') state.mode = mode
    const cached = readText(path.join(dir, 'locale-cache'))
    if (cached) state.pinned = resolveId(cached)
  }
  if (state.mode === 'fixed' && !state.pinned) state.mode = 'auto'
}

// 生效语言 + 判定依据（自检和排障时要看“为什么是这个语言”）
function effective() {
  if (state.envLocale) return { id: resolveId(state.envLocale), source: 'env' }
  if (state.mode === 'fixed' && state.pinned) return { id: state.pinned, source: 'pinned' }
  if (state.pageLang) return { id: resolveId(state.pageLang), source: 'page' }
  const first = state.systemIds.find((id) => dictionaries.has(id))
  if (first && first !== FALLBACK) return { id: first, source: 'system' }
  return { id: FALLBACK, source: 'fallback' }
}

function messages() {
  return dictionaries.get(effective().id)
}

function supported() {
  return SUPPORTED_IDS.map((id) => ({ id, displayName: dictionaries.get(id).displayName }))
}

// 用户在语言菜单里点某一种语言
function pin(id) {
  const next = resolveId(id)
  state.mode = 'fixed'
  state.pinned = next
  const dir = cacheDir()
  if (dir) {
    writeText(path.join(dir, 'locale-cache'), next)
    writeText(path.join(dir, 'locale-mode'), 'fixed')
  }
  return effective()
}

// 回到“跟随界面语言”
function follow() {
  state.mode = 'auto'
  const dir = cacheDir()
  if (dir) writeText(path.join(dir, 'locale-mode'), 'auto')
  return effective()
}

// 页面语言变了（引擎改了设置 / 换了界面语言）
function notePageLang(raw) {
  const next = typeof raw === 'string' && raw ? raw : null
  const before = effective().id
  state.pageLang = next
  return effective().id !== before
}

// 引擎的 translate 用的是 `{name}` 占位（formatDesktopMessage 同），保持一致
function format(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

function debugState() {
  const eff = effective()
  return {
    effective: eff.id,
    source: eff.source,
    mode: state.mode,
    pinned: state.pinned,
    pageLang: state.pageLang,
    systemIds: state.systemIds,
    supported: SUPPORTED_IDS,
    fallback: FALLBACK,
  }
}

function mode() {
  return state.mode
}

module.exports = { init, resolveId, effective, messages, supported, pin, follow, notePageLang, format, mode, debugState }
