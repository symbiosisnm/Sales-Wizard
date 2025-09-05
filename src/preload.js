const { contextBridge, ipcRenderer } = require('electron');

const api = {
  updateSizes: () => ipcRenderer.invoke('update-sizes'),
  getCursorPoint: () => ipcRenderer.invoke('get-cursor-point'),
  secureGetApiKey: () => ipcRenderer.invoke('secure-get-api-key'),
  secureSetApiKey: value => ipcRenderer.invoke('secure-set-api-key', value),
  initializeGemini: (apiKey, prompt, profile, language) =>
    ipcRenderer.invoke('initialize-gemini', apiKey, prompt, profile, language),
  startMacosAudio: () => ipcRenderer.invoke('start-macos-audio'),
  stopMacosAudio: () => ipcRenderer.invoke('stop-macos-audio'),
  sendImageContent: payload => ipcRenderer.invoke('send-image-content', payload),
  sendAudioContent: payload => ipcRenderer.invoke('send-audio-content', payload),
  sendTextMessage: text => ipcRenderer.invoke('send-text-message', text),
  closeSession: () => ipcRenderer.invoke('close-session'),
  quitApplication: () => ipcRenderer.invoke('quit-application'),
  toggleWindowVisibility: () => ipcRenderer.invoke('toggle-window-visibility'),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  viewChanged: view => ipcRenderer.send('view-changed', view),
  updateKeybinds: keybinds => ipcRenderer.send('update-keybinds', keybinds),
  setContextParams: params => ipcRenderer.invoke('set-context-params', params),
  updateGoogleSearchSetting: enabled =>
    ipcRenderer.invoke('update-google-search-setting', enabled),
  updateContentProtection: enabled =>
    ipcRenderer.invoke('update-content-protection', enabled),
  getRandomDisplayName: () => ipcRenderer.invoke('get-random-display-name'),
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
