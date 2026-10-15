import { resolveBounds, centeredBounds } from "./state.js";
import { appUrl } from "./protocol.js";

export function createWindowManager({ createWindow, getDisplays, getPrimaryDisplay, getSavedState,
  saveWindowState, onChange = () => {}, isQuitting = () => false }) {
  const open = new Map();
  const chains = new Map();
  const snapshots = new Map();
  function live(id) {
    const win = open.get(id);
    if (win?.isDestroyed()) { open.delete(id); return null; }
    return win;
  }
  async function openNow(app) {
    if (isQuitting()) throw new Error("Launcher is shutting down");
    const existing = live(app.id);
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show(); existing.focus(); onChange();
      return existing;
    }
    const displays = getDisplays();
    const primary = getPrimaryDisplay?.() ?? displays[0];
    const saved = getSavedState(app.id) ?? {};
    const bounds = resolveBounds(saved.bounds, centeredBounds(app.width, app.height, primary), displays);
    const win = createWindow(app, { bounds, alwaysOnTop: saved.alwaysOnTop ?? true });
    open.set(app.id, win);
    const snapshot = () => {
      if (!win.isDestroyed()) saveWindowState(app.id, {
        bounds: win.getNormalBounds?.() ?? win.getBounds(), alwaysOnTop: win.isAlwaysOnTop(),
      });
    };
    snapshots.set(win, snapshot);
    win.on("move", snapshot); win.on("resize", snapshot); win.on("close", snapshot);
    for (const event of ["show", "hide", "minimize", "restore", "always-on-top-changed"]) win.on(event, onChange);
    win.on("closed", () => {
      snapshots.delete(win);
      if (open.get(app.id) === win) open.delete(app.id);
      onChange();
    });
    try {
      await win.loadURL(appUrl(app.file));
      if (isQuitting() || win.isDestroyed()) throw new Error("App closed while opening");
      snapshot(); onChange();
      return win;
    } catch (error) {
      if (open.get(app.id) === win) open.delete(app.id);
      snapshots.delete(win);
      if (!win.isDestroyed()) win.destroy?.();
      onChange();
      throw error;
    }
  }
  function openApp(app) {
    const previous = chains.get(app.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => openNow(app));
    chains.set(app.id, next);
    const cleanup = () => { if (chains.get(app.id) === next) chains.delete(app.id); };
    next.then(cleanup, cleanup);
    return next;
  }
  function showHide(id) {
    const win = live(id);
    if (!win) return null;
    if (win.isVisible() && !win.isMinimized()) win.hide();
    else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    onChange(); return win.isVisible();
  }
  function toggleAlwaysOnTop(id, value) {
    const win = live(id);
    if (!win) return null;
    const next = typeof value === "boolean" ? value : !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next); saveWindowState(id, { alwaysOnTop: next }); onChange();
    return next;
  }
  return {
    openApp, showHide, toggleAlwaysOnTop, has: (id) => Boolean(live(id)),
    getWindowStates: () => [...open.keys()].filter((id) => live(id)).map((id) => {
      const win = live(id);
      return { id, open: true, visible: win.isVisible() && !win.isMinimized(), alwaysOnTop: win.isAlwaysOnTop() };
    }),
    flush: () => { for (const snapshot of snapshots.values()) snapshot(); },
  };
}
