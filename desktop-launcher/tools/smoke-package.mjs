// Optional packaged-runtime check. The debug port is enabled only for this invocation.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const executable = path.resolve(process.argv[2] ?? "dist/Desktop App Launcher 1.0.0.exe");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-launcher-package-"));
const server = net.createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
  env, windowsHide: true, stdio: "ignore",
});
let exited = false;
child.on("exit", () => { exited = true; });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });

async function poll(fn) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch { /* Wait for startup. */ }
    await delay(200);
  }
  throw new Error("Packaged application did not become ready");
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onclose = () => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error("Debugger disconnected")); }
    pending.clear();
  };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id); clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  };
  return {
    close: () => socket.close(),
    call: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    }),
  };
}
let launcher, sip, browser;
try {
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then((result) => result.json());
  const target = await poll(async () => (await targets()).find((item) => item.url.endsWith("launcher.html")));
  launcher = await connect(target.webSocketDebuggerUrl);
  const evaluate = async (client, expression) => {
    const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const registry = await evaluate(launcher, "desktopLauncher.listApps()");
  assert.equal(registry.ok, true, JSON.stringify(registry));
  assert.ok(registry.apps.some((item) => item.id === "sip"));
  assert.equal((await evaluate(launcher, "desktopLauncher.openApp('sip')")).ok, true);
  const sipTarget = await poll(async () => (await targets()).find((item) => item.url === "app://local/sip.html"));
  sip = await connect(sipTarget.webSocketDebuggerUrl);
  assert.equal(await evaluate(sip, "document.querySelector('h1').textContent"), "Sip");
  assert.equal(await evaluate(sip, "typeof require + ':' + typeof desktopLauncher"), "undefined:undefined");
  assert.equal((await evaluate(launcher, "desktopLauncher.getWindowStates()")).states[0].alwaysOnTop, true);
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((result) => result.json());
  browser = await connect(version.webSocketDebuggerUrl);
  try { await browser.call("Browser.close"); }
  catch (error) { if (!/Debugger disconnected/.test(error.message)) throw error; }
  await poll(() => exited);
  console.log(`PASS: packaged executable launched, bundled registry and Sip loaded via app://local, renderer isolation and pin default confirmed, clean quit. ${executable}`);
  console.log("Clean-machine install, offline OS setup, tray interaction, audio, and notification delivery remain manual checks.");
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  launcher?.close(); sip?.close(); browser?.close();
  if (!exited) child.kill();
}
