import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { normalizeApp, resolveAppPath, resolveAppPathReal } from "../src/registry.js";
import { resolveRequest, appUrl } from "../src/protocol.js";
import { sanitizeState, writeState } from "../src/state.js";
import { CHANNELS, createHandlers, installIpc } from "../src/launcher-ipc.js";
import { isLauncherSender, isLocalNavigation, protectWindow, installSessionPolicy } from "../src/security.js";
import { createWindowManager } from "../src/windows.js";
import { buildTrayMenu } from "../src/tray.js";

test("all known optional fields reject invalid types and dimensions reject non-finite numbers", () => {
  const base = { id: "a", name: "A", file: "a.html" };
  for (const field of ["mode", "description", "width", "height"]) {
    for (const value of [null, {}, [], true]) assert.throws(() => normalizeApp({ ...base, [field]: value }));
  }
  for (const value of [NaN, Infinity, "400"]) assert.throws(() => normalizeApp({ ...base, width: value }));
  for (const mode of ["popup", "sidepanel", "unknown"]) assert.equal(normalizeApp({ ...base, mode }).mode, "window");
  assert.throws(() => normalizeApp({ ...base, name: " " }));
});

test("path checks run before normalization and reject Windows, encoded, and double-encoded escapes", () => {
  for (const file of ["a/../sip.html", "%252e%252e%252fsecret", "a\\sip.html", "C:/Windows/win.ini",
    "//server/share", "sip.html:stream", "%00sip.html", "%", "a/.. /secret", "sip.html."]) {
    assert.equal(resolveAppPath(os.tmpdir(), file), null, file);
    assert.equal(resolveRequest(`app://local/${file}`, { rootDir: os.tmpdir() }).status, 403, file);
  }
  assert.equal(appUrl("some%20folder/test.html"), "app://local/some%20folder/test.html");
});

test("escaping junctions are rejected while legitimate nested files are served", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-security-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "apps"), outside = path.join(dir, "outside");
  fs.mkdirSync(root); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.html"), "secret");
  fs.symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(resolveAppPathReal(root, "escape/secret.html"), null);
  assert.equal(resolveRequest("app://local/escape/secret.html", { rootDir: root }).status, 403);
});

test("protocol rejects credentials, ports, alternate hosts, and absolute paths", () => {
  for (const url of ["app://local:80/sip.html", "app://user@local/sip.html", "https://local/sip.html", "app://local.evil/sip.html"]) {
    assert.equal(resolveRequest(url, { rootDir: os.tmpdir() }).status, 404);
  }
  assert.equal(resolveRequest("app://local//sip.html", { rootDir: os.tmpdir() }).status, 403);
});

test("saved bounds reject invalid sizes and special app IDs cannot alter prototypes", () => {
  const raw = JSON.parse('{"apps":{"__proto__":{"alwaysOnTop":false},"bad":{"bounds":{"x":0,"y":0,"width":-1,"height":300}}}}');
  const clean = sanitizeState(raw);
  assert.equal(Object.getPrototypeOf(clean.apps), Object.prototype);
  assert.equal(Object.hasOwn(clean.apps, "__proto__"), true);
  assert.equal(clean.apps.bad, undefined);
});

test("failed atomic rename cleans the temporary file without replacing saved state", () => {
  const calls = [];
  assert.throws(() => writeState("state.json", { apps: {}, launcher: {} }, {
    writeFileSync: (file) => calls.push(["write", file]),
    renameSync: () => { throw new Error("disk unavailable"); },
    unlinkSync: (file) => calls.push(["unlink", file]),
  }), /disk unavailable/);
  assert.deepEqual(calls, [["write", "state.json.tmp"], ["unlink", "state.json.tmp"]]);
});

test("IPC checks actual sender identity, main frame identity, and exact launcher URL", () => {
  const mainFrame = { url: "file:///launcher.html" }, contents = { mainFrame };
  const win = { isDestroyed: () => false, webContents: contents };
  assert.equal(isLauncherSender({ sender: contents, senderFrame: mainFrame }, win, mainFrame.url), true);
  assert.equal(isLauncherSender({ sender: contents, senderFrame: { url: mainFrame.url } }, win, mainFrame.url), false);
  assert.equal(isLauncherSender({ sender: {}, senderFrame: mainFrame }, win, mainFrame.url), false);
  assert.equal(isLauncherSender({ sender: contents, senderFrame: mainFrame }, win, "file:///other.html"), false);
  assert.equal(isLauncherSender({}, null, mainFrame.url), false);
});

test("IPC rejects unauthorized callers, extra arguments, and injected channel names", async () => {
  const registered = new Map();
  const handlers = createHandlers({ getRegistry: () => ({ apps: [], byId: new Map() }), windows: {} });
  installIpc({ ipcMain: { handle: (name, handler) => registered.set(name, handler) },
    handlers: { ...handlers, evil: () => assert.fail() }, isTrustedSender: (event) => event.trusted === true });
  assert.equal(registered.has("evil"), false);
  assert.equal((await registered.get(CHANNELS.openApp)({}, "sip")).error, "Untrusted sender");
  assert.equal((await registered.get(CHANNELS.openApp)({ trusted: true }, "sip", "/secret")).error, "Invalid request");
  assert.equal((await registered.get(CHANNELS.listApps)({ trusted: true }, "extra")).error, "Invalid request");
});

test("navigation, popups, redirects, downloads, webviews, and permissions are restricted", () => {
  const session = new EventEmitter();
  session.setPermissionRequestHandler = (handler) => { session.request = handler; };
  session.setPermissionCheckHandler = (handler) => { session.check = handler; };
  const contents = new EventEmitter();
  contents.setWindowOpenHandler = (handler) => { contents.popup = handler; };
  contents.getURL = () => "app://local/sip.html";
  contents.isDestroyed = () => false;
  const rootDir = os.tmpdir();
  protectWindow({ webContents: contents }, (url) => isLocalNavigation(url, rootDir));
  assert.deepEqual(contents.popup(), { action: "deny" });
  for (const name of ["will-navigate", "will-redirect", "will-attach-webview"]) {
    let prevented = false;
    contents.emit(name, { preventDefault: () => { prevented = true; } }, "https://example.com");
    assert.equal(prevented, true, name);
  }
  installSessionPolicy(session, { rootDir, isAppContents: (item) => item === contents });
  assert.equal(session.check(contents, "notifications", "app://local"), true);
  assert.equal(session.check(contents, "camera", "app://local"), false);
  assert.equal(session.check(contents, "notifications", "https://example.com"), false);
  assert.equal(session.check(null, "notifications", "app://local"), false);
  let granted;
  session.request(contents, "notifications", (value) => { granted = value; }, { requestingUrl: contents.getURL() });
  assert.equal(granted, true);
  session.request(contents, "notifications", (value) => { granted = value; }, { requestingUrl: "https://example.com" });
  assert.equal(granted, false);
  let prevented = false;
  session.emit("will-download", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test("failed app loads clear tracked windows and queued opens cannot recreate during quit", async () => {
  let quitting = false, created = 0;
  const manager = createWindowManager({
    createWindow: () => {
      created++;
      const window = new EventEmitter();
      window.isDestroyed = () => false;
      window.loadURL = async () => { throw new Error("load failed"); };
      window.destroy = () => window.emit("closed");
      return window;
    },
    getDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getSavedState: () => ({}), saveWindowState: () => {}, isQuitting: () => quitting,
  });
  const app = { id: "sip", file: "sip.html", width: 380, height: 560 };
  await assert.rejects(manager.openApp(app), /load failed/);
  assert.equal(manager.has("sip"), false);
  const pending = manager.openApp(app);
  quitting = true;
  await assert.rejects(pending, /shutting down/);
  assert.equal(created, 1);
});

test("tray callbacks retain app IDs and include launcher and exit actions", () => {
  const calls = [];
  const template = buildTrayMenu({ Menu: { buildFromTemplate: (items) => items },
    apps: [{ id: "sip", name: "Sip" }], onShowLauncher: () => calls.push("launcher"),
    onShowApp: (id) => calls.push(id), onExit: () => calls.push("exit"),
  });
  for (const item of template.filter((item) => item.click)) item.click();
  assert.deepEqual(calls, ["launcher", "sip", "exit"]);
});
