import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, protocol, screen, session, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRegistry } from "./registry.js";
import { resolveRequest } from "./protocol.js";
import { readState, writeState, centeredBounds, resolveBounds } from "./state.js";
import { createLifecycle } from "./lifecycle.js";
import { createWindowManager } from "./windows.js";
import { createHandlers, installIpc } from "./launcher-ipc.js";
import { buildTrayMenu } from "./tray.js";
import { WEB_PREFERENCES, protectWindow, isLocalNavigation, isLauncherSender, installSessionPolicy } from "./security.js";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const launcherFile = path.join(srcDir, "launcher.html");
const launcherUrl = pathToFileURL(launcherFile).href;
const rootDir = app.isPackaged ? path.join(process.resourcesPath, "apps") : path.resolve(srcDir, "../../local-launcher/apps");
const iconPath = path.join(srcDir, "../assets/app-icon.png");
const lifecycle = createLifecycle();
const appContents = new Set();
let launcherWindow, tray, windowManager, stateFile, writeTimer;
let registry = { apps: [], byId: new Map() };
let registryError = null;
let state = { apps: {}, launcher: {} };

function persistNow() {
  clearTimeout(writeTimer);
  if (!stateFile) return;
  try { writeState(stateFile, state); }
  catch (error) { console.error("Unable to save window preferences:", error); }
}
function schedulePersist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(persistNow, 250);
}
function snapshotLauncher() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    state.launcher.bounds = launcherWindow.getNormalBounds();
    schedulePersist();
  }
}
function sendWindowStates() {
  if (launcherWindow && !launcherWindow.isDestroyed() && windowManager) {
    launcherWindow.webContents.send("launcher:window-states", windowManager.getWindowStates());
  }
}
function getRegistry() {
  if (registryError) throw registryError;
  return registry;
}
function refreshRegistry() {
  try { registry = loadRegistry(path.join(rootDir, "apps.json")); registryError = null; }
  catch (error) {
    registry = { apps: [], byId: new Map() };
    registryError = new Error(`apps.json is missing or invalid — fix it, then Refresh. ${error.message}`);
  }
  updateTray();
  return getRegistry();
}
function showLauncher() {
  if (lifecycle.isQuitting() || !app.isReady() || !windowManager) return;
  if (!launcherWindow || launcherWindow.isDestroyed()) createLauncherWindow();
  if (launcherWindow.isMinimized()) launcherWindow.restore();
  launcherWindow.show(); launcherWindow.focus();
}
function createLauncherWindow() {
  const bounds = resolveBounds(state.launcher.bounds,
    centeredBounds(420, 320, screen.getPrimaryDisplay()), screen.getAllDisplays());
  const win = new BrowserWindow({ ...bounds, minWidth: 320, minHeight: 240,
    maxWidth: 1600, maxHeight: 1200, title: "Desktop App Launcher", icon: iconPath,
    webPreferences: { ...WEB_PREFERENCES, preload: path.join(srcDir, "preload.js") },
  });
  launcherWindow = win;
  win.removeMenu();
  protectWindow(win, (url) => url === launcherUrl);
  win.on("close", (event) => {
    snapshotLauncher();
    if (lifecycle.shouldHideOnClose("launcher")) { event.preventDefault(); win.hide(); }
  });
  win.on("move", snapshotLauncher); win.on("resize", snapshotLauncher);
  win.on("query-session-end", beginQuit); win.on("session-end", beginQuit);
  win.on("closed", () => { if (launcherWindow === win) launcherWindow = null; });
  win.loadFile(launcherFile).catch((error) => {
    dialog.showErrorBox("Unable to load launcher", String(error)); beginQuit(); app.quit();
  });
}
function createAppWindow(entry, options) {
  const win = new BrowserWindow({ ...options.bounds, minWidth: 240, minHeight: 240,
    maxWidth: 1600, maxHeight: 1200, title: entry.name, icon: iconPath,
    alwaysOnTop: options.alwaysOnTop, webPreferences: { ...WEB_PREFERENCES },
  });
  appContents.add(win.webContents);
  const contents = win.webContents;
  win.removeMenu();
  protectWindow(win, (url) => isLocalNavigation(url, rootDir));
  win.on("closed", () => appContents.delete(contents));
  win.on("query-session-end", beginQuit); win.on("session-end", beginQuit);
  return win;
}
function updateTray() {
  if (!tray || lifecycle.isQuitting()) return;
  tray.setContextMenu(buildTrayMenu({ Menu, apps: registry.apps,
    onShowLauncher: showLauncher,
    onShowApp: (id) => {
      const entry = registry.apps.find((item) => item.id === id);
      if (entry) windowManager.openApp(entry).catch((error) => {
        dialog.showErrorBox("Unable to open app", String(error));
      });
    },
    onExit: () => { beginQuit(); app.quit(); },
  }));
}
function beginQuit() {
  lifecycle.beginQuit();
  windowManager?.flush(); snapshotLauncher(); persistNow();
}

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true,
} }]);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId("com.thebuilderpros.desktoplauncher");
  app.on("second-instance", showLauncher);
  app.on("activate", showLauncher);
  app.on("before-quit", beginQuit);
  app.on("will-quit", () => { persistNow(); tray?.destroy(); });
  app.on("window-all-closed", () => { /* Tray owns process lifetime. */ });
  app.whenReady().then(() => {
    stateFile = path.join(app.getPath("userData"), "window-state.json");
    state = readState(stateFile);
    protocol.handle("app", async (request) => {
      if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
      const result = resolveRequest(request.url, { rootDir });
      if (result.status !== 200) return new Response("Unavailable", { status: result.status });
      try {
        const data = request.method === "HEAD" ? null : await fs.promises.readFile(result.filePath);
        return new Response(data, { headers: { "content-type": result.mime, "x-content-type-options": "nosniff" } });
      } catch { return new Response("Not found", { status: 404 }); }
    });
    installSessionPolicy(session.defaultSession, { rootDir, isAppContents: (contents) => appContents.has(contents) });
    try { refreshRegistry(); } catch { /* Renderer displays recoverable registry errors. */ }
    windowManager = createWindowManager({ createWindow: createAppWindow,
      getDisplays: () => screen.getAllDisplays(), getPrimaryDisplay: () => screen.getPrimaryDisplay(),
      getSavedState: (id) => Object.hasOwn(state.apps, id) ? state.apps[id] : {},
      saveWindowState: (id, partial) => {
        const previous = Object.hasOwn(state.apps, id) ? state.apps[id] : {};
        Object.defineProperty(state.apps, id, { value: { ...previous, ...partial }, enumerable: true, configurable: true, writable: true });
        schedulePersist();
      }, onChange: sendWindowStates, isQuitting: lifecycle.isQuitting,
    });
    installIpc({ ipcMain, handlers: createHandlers({ getRegistry, refreshRegistry, windows: windowManager }),
      isTrustedSender: (event) => isLauncherSender(event, launcherWindow, launcherUrl),
    });
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error("Launcher icon could not be loaded");
    tray = new Tray(icon); tray.setToolTip("Desktop App Launcher");
    tray.on("click", showLauncher); updateTray(); createLauncherWindow();
  }).catch((error) => {
    dialog.showErrorBox("Desktop launcher could not start", String(error)); beginQuit(); app.quit();
  });
}
