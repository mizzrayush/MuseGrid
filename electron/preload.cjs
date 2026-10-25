const { contextBridge, ipcRenderer } = require('electron')

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel, listener) {
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(channel, ...omit) {
    return ipcRenderer.off(channel, ...omit)
  },
  send(channel, ...omit) {
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(channel, ...omit) {
    return ipcRenderer.invoke(channel, ...omit)
  },
})
