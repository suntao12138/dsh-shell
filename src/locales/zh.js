// 简体中文词典 —— 与 src/locales/en.js 键集合必须完全一致（src/i18n.js 加载时校验，
// 少一个键就直接抛错，杜绝“半个菜单是中文、半个是英文”）。
//
// 文案来源（尽量不自造，注释标明）：
//   [桌面] 上游 apps/desktop/src/locale.ts 的 zh 词典（win32/darwin 用它覆盖内置 role 标签）
//   [引擎] 已安装引擎 @deepseek-ai/dsh-client-locale 的 common / settings.locale 词典
//   [自撰] 只有 2 条：语言跟随、更新检查对话框正文（上游那是它自己安装包的功能）
module.exports = {
  id: 'zh',
  // 语言选择器里显示的名字：引擎 BUILT_IN_LOCALE_METADATA 里就是「中文」
  displayName: '中文',

  menu: {
    application: '应用',                 // [桌面] application
    edit: '编辑',                        // [引擎] common.edit（上游 Linux 用 Electron 内置 'editMenu'，
                                         //        Linux 上 Electron 不翻译它，所以这里显式给标签）
    language: '语言',                     // [引擎] settings.locale language.title
    languageFollow: '跟随界面语言',        // [自撰]
    about: '关于 DeepSeek Harness',       // [桌面] aboutMenu
    checkUpdates: '检查更新…',            // [桌面] checkUpdatesMenu
    reload: '刷新页面',                   // [桌面] reloadPageMenu
    restartAppHost: '重启应用与 Host',     // [桌面] restartAppHostMenu
    devTools: '开发者工具',               // [桌面] toggleDevToolsMenu
    quit: '退出',                        // [桌面] quit
  },

  // 网页里右键菜单的编辑项。上游 main.ts:363 在 win32 上用同名键覆盖 role 标签，
  // Linux 上 Electron 同样不翻译 role，所以这里全部显式给标签。
  roles: {
    undo: '撤销',                        // [桌面] undo
    redo: '重做',                        // [桌面] redo
    cut: '剪切',                         // [桌面] cut
    copy: '复制',                        // [桌面] copy
    paste: '粘贴',                       // [桌面] paste
    delete: '删除',                       // [桌面] delete
    selectAll: '全选',                    // [桌面] selectAll
  },

  // 启动失败 / 引擎崩溃的相关文案（showError、自动重启上限）
  startup: {
    title: 'DeepSeek Harness 无法启动',
    failed: '本地 dsh web 服务不可用',
    logLabel: '日志：{path}',
    retry: '重试',                        // [引擎] common.retry
    quit: '退出',                        // [桌面] quit
    crashLoop: 'dsh web 连续异常退出 {count} 次，已停止自动重启',
  },

  update: {
    // [自撰] 上游的“检查更新”查的是它自己的安装包；薄壳没有安装包通道，这里查引擎版本
    upToDate: 'dsh 引擎已是最新版本（{version}）。',
    available: 'dsh 引擎：当前 {current}，最新 {candidate}。',
    detail: '薄壳本体没有独立更新通道，可更新的是引擎（npm 包）。更新命令：\n\nnpm install -g --registry=https://registry.npmjs.org/ @deepseek-ai/dsh@next\n\n更新后重启本应用生效。',
    failed: '无法访问 npm registry，请检查网络或代理后重试。',
    ok: '确定',                          // [引擎] common.ok
  },
}
