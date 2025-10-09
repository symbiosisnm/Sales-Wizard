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
  sendImageContent: payload => ipcRenderer.invoke('live-send-screen', payload),
  sendAudioContent: payload => ipcRenderer.invoke('live-send-audio', payload),
  sendTextMessage: text => ipcRenderer.invoke('send-text-message', text),
  startLiveStream: options => ipcRenderer.invoke('start-live-stream', options),
  stopLiveStream: options => ipcRenderer.invoke('stop-live-stream', options),
  liveSendAudio: payload => ipcRenderer.invoke('live-send-audio', payload),
  liveSendScreen: payload => ipcRenderer.invoke('live-send-screen', payload),
  closeSession: () => ipcRenderer.invoke('close-session'),
  quitApplication: () => ipcRenderer.invoke('quit-application'),
  toggleWindowVisibility: () => ipcRenderer.invoke('toggle-window-visibility'),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  viewChanged: view => ipcRenderer.send('view-changed', view),
  updateKeybinds: keybinds => ipcRenderer.send('update-keybinds', keybinds),
  contextGet: () => ipcRenderer.invoke('context:get'),
  contextSet: params => ipcRenderer.invoke('context:set', params),
  updateGoogleSearchSetting: enabled =>
    ipcRenderer.invoke('update-google-search-setting', enabled),
  updateContentProtection: enabled =>
    ipcRenderer.invoke('update-content-protection', enabled),
  getContentProtection: () => ipcRenderer.invoke('get-content-protection'),
  getRandomDisplayName: () => ipcRenderer.invoke('get-random-display-name'),
  exportSession: options => ipcRenderer.invoke('export-session', options),
  historyList: () => ipcRenderer.invoke('history:list'),
  historyGet: sessionId => ipcRenderer.invoke('history:get', sessionId),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  historySetLimit: limit => ipcRenderer.invoke('history:set-limit', limit),
  historyAddTurn: payload => ipcRenderer.invoke('history:add-turn', payload),
  assistantAsk: prompt => ipcRenderer.invoke('assistant:ask', prompt),
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
