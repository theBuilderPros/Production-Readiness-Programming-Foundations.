import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNELS, createHandlers, installIpc } from "../src/launcher-ipc.js";

function fakeDeps() {
  const openCalls = [];
  const registry = {
    apps: [{ id: "sip", name: "Sip", file: "sip.html", path: "/apps/sip.html", width: 380, height: 560, description: "Water reminder" }],
    byId: new Map([["sip", "/apps/sip.html"]]),
  };
  const windows = {
    openApp: (app) => { openCalls.push(app.id); return { id: app.id }; },
    showHide: () => true,
    toggleAlwaysOnTop: () => false,
    getWindowStates: () => [{ id: "sip", open: true, visible: true, alwaysOnTop: true }],
  };
  return { openCalls, handlers: createHandlers({ getRegistry: () => registry, windows }) };
}

test("listApps omits absolute file paths", async () => {
  const { handlers } = fakeDeps();
  const result = await handlers[CHANNELS.listApps]();
  assert.equal(result.ok, true);
  assert.equal(result.apps[0].id, "sip");
  assert.equal(result.apps[0].path, undefined);
});

test("openApp validates the id and only opens registered apps", async () => {
  const { handlers, openCalls } = fakeDeps();
  assert.equal((await handlers[CHANNELS.openApp]({}, "sip")).ok, true);
  assert.equal((await handlers[CHANNELS.openApp]({}, "../evil")).ok, false);
  assert.equal((await handlers[CHANNELS.openApp]({}, "missing")).ok, false);
  assert.deepEqual(openCalls, ["sip"]);
});

test("registry errors are reported, not thrown", async () => {
  const handlers = createHandlers({
    getRegistry: () => { throw new Error("apps.json is not valid JSON"); },
    windows: { openApp: () => ({}), showHide: () => true, toggleAlwaysOnTop: () => false, getWindowStates: () => [] },
  });
  const result = await handlers[CHANNELS.listApps]();
  assert.equal(result.ok, false);
  assert.match(result.error, /valid JSON/);
});

test("installIpc rejects untrusted senders and unknown channels", () => {
  const registered = new Map();
  const ipcMain = {
    handle: (channel, fn) => registered.set(channel, fn),
    removeHandler: (channel) => registered.delete(channel),
  };
  const { handlers } = fakeDeps();
  installIpc({ ipcMain, handlers, isTrustedSender: (event) => event?.trusted === true });
  assert.ok(registered.has(CHANNELS.listApps));
  assert.equal(registered.has("evil:channel"), false);
});
