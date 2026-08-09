const { contextBridge, ipcRenderer } = require('electron');

const api = {
  updateSizes: () => ipcRenderer.invoke('update-sizes'),
  getCursorPoint: () => ipcRenderer.invoke('get-cursor-point'),
  getActiveWindow: () => ipcRenderer.invoke('get-active-window'),
  secureGetApiKey: () => ipcRenderer.invoke('secure-get-api-key'),
  secureSetApiKey: value => ipcRenderer.invoke('secure-set-api-key', value),
  quitApplication: () => ipcRenderer.invoke('quit-application'),
  toggleWindowVisibility: () => ipcRenderer.invoke('toggle-window-visibility'),
  setMouseEventsIgnored: ignored => ipcRenderer.invoke('set-mouse-events-ignored', ignored),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  viewChanged: view => ipcRenderer.send('view-changed', view),
  updateKeybinds: keybinds => ipcRenderer.send('update-keybinds', keybinds),
  setContextParams: params => ipcRenderer.invoke('set-context-params', params),
  knowledgeList: options => ipcRenderer.invoke('knowledge-list', options),
  knowledgeImportGuideline: options => ipcRenderer.invoke('knowledge-import-guideline', options),
  knowledgeImportUrl: options => ipcRenderer.invoke('knowledge-import-url', options),
  knowledgeImportFile: options => ipcRenderer.invoke('knowledge-import-file', options),
  knowledgeUpdate: options => ipcRenderer.invoke('knowledge-update', options),
  knowledgeDelete: options => ipcRenderer.invoke('knowledge-delete', options),
  updateContentProtection: enabled =>
    ipcRenderer.invoke('update-content-protection', enabled),
  getRandomDisplayName: () => ipcRenderer.invoke('get-random-display-name'),
  exportSession: options => ipcRenderer.invoke('export-session', options),
  onUpdateResponse: handler => ipcRenderer.on('update-response', handler),
  removeUpdateResponseListener: handler =>
    ipcRenderer.removeListener('update-response', handler),
  onUpdateStatus: handler => ipcRenderer.on('update-status', handler),
  removeUpdateStatusListener: handler =>
    ipcRenderer.removeListener('update-status', handler),
  onClickThroughToggled: handler =>
    ipcRenderer.on('click-through-toggled', handler),
  removeClickThroughToggledListener: handler =>
    ipcRenderer.removeListener('click-through-toggled', handler),
  onSessionInitializing: handler =>
    ipcRenderer.on('session-initializing', handler),
  removeSessionInitializingListeners: () =>
    ipcRenderer.removeAllListeners('session-initializing'),
  onNavigatePreviousResponse: handler =>
    ipcRenderer.on('navigate-previous-response', handler),
  removeNavigatePreviousResponse: handler =>
    ipcRenderer.removeListener('navigate-previous-response', handler),
  onNavigateNextResponse: handler =>
    ipcRenderer.on('navigate-next-response', handler),
  removeNavigateNextResponse: handler =>
    ipcRenderer.removeListener('navigate-next-response', handler),
  onScrollResponseUp: handler => ipcRenderer.on('scroll-response-up', handler),
  removeScrollResponseUp: handler =>
    ipcRenderer.removeListener('scroll-response-up', handler),
  onScrollResponseDown: handler =>
    ipcRenderer.on('scroll-response-down', handler),
  removeScrollResponseDown: handler =>
    ipcRenderer.removeListener('scroll-response-down', handler),
  onSaveConversationTurn: handler =>
    ipcRenderer.on('save-conversation-turn', handler),
  removeSaveConversationTurnListener: handler =>
    ipcRenderer.removeListener('save-conversation-turn', handler)
};

contextBridge.exposeInMainWorld('electron', api);
