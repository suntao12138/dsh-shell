// English dictionary — complete key set (see src/locales/zh.js for provenance of each key).
module.exports = {
  id: 'en',
  // Label shown in the language picker: the engine's own BUILT_IN_LOCALE_METADATA.en.label.
  displayName: 'English',

  menu: {
    application: 'Application',
    edit: 'Edit',
    language: 'Language',
    languageFollow: 'Follow the app language',
    about: 'About DeepSeek Harness',
    checkUpdates: 'Check for Updates…',
    reload: 'Reload Page',
    restartAppHost: 'Restart App and Host',
    devTools: 'Developer tools',
    quit: 'Quit',
  },

  // Context-menu roles; Electron does not translate native role labels on Linux.
  roles: {
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    delete: 'Delete',
    selectAll: 'Select All',
  },

  startup: {
    title: 'Could not start DeepSeek Harness',
    failed: 'The local dsh web service is not available',
    logLabel: 'Log: {path}',
    retry: 'Retry',
    quit: 'Quit',
    crashLoop: 'dsh web exited abnormally {count} times in a row; automatic restart stopped',
  },

  update: {
    upToDate: 'Already on the newest dsh engine ({version}).',
    available: 'dsh engine: current {current}, newest {candidate}.',
    detail: 'This shell has no separate update channel; the updatable part is the engine (npm package). Update it with:\n\nnpm install -g --registry=https://registry.npmjs.org/ @deepseek-ai/dsh@next\n\nRestart the shell afterwards.',
    failed: 'The npm registry could not be reached. Check network/proxy, then retry.',
    ok: 'OK',
  },
}
