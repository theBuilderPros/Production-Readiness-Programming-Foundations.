const { contextBridge, ipcRenderer } = require("electron");

const stateChannel = "launcher:window-states";

contextBridge.exposeInMainWorld("desktopLauncher", {
  listApps: () => ipcRenderer.invoke("launcher:list-apps"),
  openApp: (id) => ipcRenderer.invoke("launcher:open-app", id),
  showHideApp: (id) => ipcRenderer.invoke("launcher:show-hide-app", id),
  toggleAlwaysOnTop: (id) => ipcRenderer.invoke("launcher:toggle-always-on-top", id),
  getWindowStates: () => ipcRenderer.invoke("launcher:get-window-states"),
  refreshApps: () => ipcRenderer.invoke("launcher:refresh-apps"),
  onWindowStates: (callback) => {
    const listener = (_event, states) => callback(states);
    ipcRenderer.on(stateChannel, listener);
    return () => ipcRenderer.removeListener(stateChannel, listener);
  },
});
