export const CHANNELS = {
  listApps: "launcher:list-apps",
  openApp: "launcher:open-app",
  showHideApp: "launcher:show-hide-app",
  toggleAlwaysOnTop: "launcher:toggle-always-on-top",
  getWindowStates: "launcher:get-window-states",
  refreshApps: "launcher:refresh-apps",
};

function publicApp(app) {
  return {
    id: app.id,
    name: app.name,
    file: app.file,
    mode: app.mode,
    width: app.width,
    height: app.height,
    description: app.description,
  };
}

export function createHandlers({ getRegistry, refreshRegistry = getRegistry, windows }) {
  function safe(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    };
  }

  function findApp(id) {
    const { apps } = getRegistry();
    return apps.find((app) => app.id === id) ?? null;
  }

  return {
    [CHANNELS.listApps]: safe(async () => {
      const { apps } = getRegistry();
      return { ok: true, apps: apps.map(publicApp) };
    }),

    [CHANNELS.refreshApps]: safe(async () => {
      const { apps } = refreshRegistry();
      return { ok: true, apps: apps.map(publicApp) };
    }),

    [CHANNELS.openApp]: safe(async (_event, id) => {
      if (typeof id !== "string") return { ok: false, error: "Invalid app id" };
      const app = findApp(id);
      if (!app) return { ok: false, error: `Unknown app "${id}"` };
      await windows.openApp(app);
      return { ok: true, id };
    }),

    [CHANNELS.showHideApp]: safe(async (_event, id) => {
      if (typeof id !== "string" || !findApp(id)) return { ok: false, error: `Unknown app "${id}"` };
      const visible = windows.showHide(id);
      return { ok: true, id, visible };
    }),

    [CHANNELS.toggleAlwaysOnTop]: safe(async (_event, id) => {
      if (typeof id !== "string" || !findApp(id)) return { ok: false, error: `Unknown app "${id}"` };
      const alwaysOnTop = windows.toggleAlwaysOnTop(id);
      return { ok: true, id, alwaysOnTop };
    }),

    [CHANNELS.getWindowStates]: safe(async () => {
      return { ok: true, states: windows.getWindowStates() };
    }),
  };
}

export function installIpc({ ipcMain, handlers, isTrustedSender }) {
  for (const channel of Object.values(CHANNELS)) {
    const handler = handlers[channel];
    if (typeof handler !== "function") continue;
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) return { ok: false, error: "Untrusted sender" };
      const needsId = [CHANNELS.openApp, CHANNELS.showHideApp, CHANNELS.toggleAlwaysOnTop].includes(channel);
      if (args.length !== (needsId ? 1 : 0) || (needsId && (typeof args[0] !== "string" || !args[0].trim()))) {
        return { ok: false, error: "Invalid request" };
      }
      return handler(event, args[0]);
    });
  }
}
