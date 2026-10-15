import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createWindowManager } from "../src/windows.js";

function makeFakeWindow(bounds, alwaysOnTop) {
  const win = new EventEmitter();
  win.destroyed = false;
  win.visible = true;
  win.minimized = false;
  win.alwaysOnTop = alwaysOnTop;
  win.bounds = bounds;
  win.loadedUrl = null;
  win.isDestroyed = () => win.destroyed;
  win.isVisible = () => win.visible;
  win.isMinimized = () => win.minimized;
  win.restore = () => { win.minimized = false; };
  win.show = () => { win.visible = true; };
  win.hide = () => { win.visible = false; };
  win.focus = () => { win.focused = true; };
  win.isAlwaysOnTop = () => win.alwaysOnTop;
  win.setAlwaysOnTop = (v) => { win.alwaysOnTop = v; };
  win.getBounds = () => win.bounds;
  win.loadURL = (url) => { win.loadedUrl = url; };
  win.close = () => { win.destroyed = true; win.emit("closed"); };
  return win;
}

const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
const app = { id: "sip", name: "Sip", file: "sip.html", path: "/apps/sip.html", width: 380, height: 560 };

function setup() {
  const created = [];
  const saved = {};
  const mgr = createWindowManager({
    createWindow: (a, opts) => { const w = makeFakeWindow(opts.bounds, opts.alwaysOnTop); created.push(w); return w; },
    getDisplays: () => displays,
    getSavedState: (id) => saved[id] ?? {},
    saveWindowState: (id, partial) => { saved[id] = { ...(saved[id] ?? {}), ...partial }; },
  });
  return { mgr, created, saved };
}

test("openApp creates one window and loads the app url", async () => {
  const { mgr, created } = setup();
  const win = await mgr.openApp(app);
  assert.equal(created.length, 1);
  assert.equal(win.loadedUrl, "app://local/sip.html");
  assert.equal(win.alwaysOnTop, true);
});

test("openApp focuses an existing live window instead of duplicating", async () => {
  const { mgr, created } = setup();
  const first = await mgr.openApp(app);
  first.focused = false;
  await mgr.openApp(app);
  assert.equal(created.length, 1);
  assert.equal(first.focused, true);
});

test("rapid concurrent openApp calls create exactly one window", async () => {
  const { mgr, created } = setup();
  await Promise.all([mgr.openApp(app), mgr.openApp(app), mgr.openApp(app)]);
  assert.equal(created.length, 1);
});

test("a closed window is forgotten and can be reopened", async () => {
  const { mgr, created } = setup();
  const first = await mgr.openApp(app);
  first.close();
  assert.equal(mgr.has("sip"), false);
  await mgr.openApp(app);
  assert.equal(created.length, 2);
});

test("showHide toggles visibility", async () => {
  const { mgr } = setup();
  const win = await mgr.openApp(app);
  mgr.showHide("sip");
  assert.equal(win.isVisible(), false);
  mgr.showHide("sip");
  assert.equal(win.isVisible(), true);
});

test("toggleAlwaysOnTop flips and persists", async () => {
  const { mgr, saved } = setup();
  await mgr.openApp(app);
  assert.equal(mgr.toggleAlwaysOnTop("sip"), false);
  assert.equal(saved.sip.alwaysOnTop, false);
  assert.equal(mgr.toggleAlwaysOnTop("sip"), true);
  assert.equal(mgr.toggleAlwaysOnTop("sip", false), false);
});

test("saved off-screen bounds are replaced with visible defaults", async () => {
  const saved = { sip: { bounds: { x: 9000, y: 9000, width: 380, height: 560 } } };
  const created = [];
  const mgr = createWindowManager({
    createWindow: (a, opts) => { const w = makeFakeWindow(opts.bounds, opts.alwaysOnTop); created.push(w); return w; },
    getDisplays: () => displays,
    getSavedState: (id) => saved[id] ?? {},
    saveWindowState: () => {},
  });
  await mgr.openApp(app);
  assert.ok(created[0].bounds.x < 1920 && created[0].bounds.y < 1080);
});

test("getWindowStates reports tracked windows", async () => {
  const { mgr } = setup();
  await mgr.openApp(app);
  const states = mgr.getWindowStates();
  assert.equal(states.length, 1);
  assert.deepEqual(states[0], { id: "sip", open: true, visible: true, alwaysOnTop: true });
});
