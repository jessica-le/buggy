const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('creature', {
  // Renderer → Main
  startSession: (data) => ipcRenderer.send('start-session', data),
  extendSession: (minutes) => ipcRenderer.send('extend-session', { minutes }),
  endSession: () => ipcRenderer.send('end-session'),
  endSessionEarly: () => ipcRenderer.send('end-session-early'),
  closeOverlay: () => ipcRenderer.send('close-overlay'),
  minimizeOverlay: () => ipcRenderer.send('minimize-overlay'),
  minimizeLauncher: () => ipcRenderer.send('minimize-launcher'),
  openLauncher: () => ipcRenderer.send('open-launcher'),
  getSnark: (type) => ipcRenderer.send('get-snark', type),
  restoreSession: () => ipcRenderer.send('restore-session'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getSessionState: () => ipcRenderer.invoke('get-session-state'),

  // Main → Renderer (listeners)
  onSessionStarted: (cb) => ipcRenderer.on('session-started', (_, data) => cb(data)),
  onSessionRestored: (cb) => ipcRenderer.on('session-restored', (_, data) => cb(data)),
  onSessionExtended: (cb) => ipcRenderer.on('session-extended', (_, data) => cb(data)),
  onTick: (cb) => ipcRenderer.on('tick', (_, data) => cb(data)),
  onTimerComplete: (cb) => ipcRenderer.on('timer-complete', (_, data) => cb(data)),
  onSessionEnded: (cb) => ipcRenderer.on('session-ended', (_, data) => cb(data)),
  onSnarkMessage: (cb) => ipcRenderer.on('snark-message', (_, msg) => cb(msg)),
  onSiteDetected: (cb) => ipcRenderer.on('site-detected', (_, data) => cb(data)),
})
