import { parseAppUrl } from "./protocol.js";
import { resolveAppPath } from "./registry.js";

export const WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
  webviewTag: false, allowRunningInsecureContent: false,
});

export function isLocalNavigation(url, rootDir) {
  const relative = parseAppUrl(url);
  return Boolean(relative && resolveAppPath(rootDir, relative));
}

export function isLauncherSender(event, window, launcherUrl) {
  if (!window || window.isDestroyed()) return false;
  return event?.sender === window.webContents &&
    Boolean(event.senderFrame) && event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === launcherUrl;
}

export function protectWindow(window, allowNavigation) {
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const name of ["will-navigate", "will-redirect"]) {
    contents.on(name, (event, url) => { if (!allowNavigation(url)) event.preventDefault(); });
  }
  contents.on("will-frame-navigate", (event) => {
    if (!allowNavigation(event.url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

export function installSessionPolicy(session, { isAppContents, rootDir }) {
  const allowed = (contents, permission, origin) => permission === "notifications" &&
    Boolean(contents && !contents.isDestroyed() && isAppContents(contents)) &&
    isLocalNavigation(contents.getURL(), rootDir) && origin === "app://local";
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requesting = details?.requestingUrl;
    callback(allowed(contents, permission,
      requesting === "app://local" || isLocalNavigation(requesting, rootDir) ? "app://local" : ""));
  });
  session.setPermissionCheckHandler((contents, permission, origin) => allowed(contents, permission, origin));
  session.on("will-download", (event) => event.preventDefault());
}
