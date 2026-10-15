import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

test("launcher.html declares a restrictive CSP and the app list container", () => {
  const html = fs.readFileSync(path.join(srcDir, "launcher.html"), "utf8");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /id="app-list"/);
  assert.match(html, /id="refresh"/);
  assert.match(html, /id="error-banner"/);
  assert.match(html, /src="\.\/launcher\.js"/);
});

test("preload exposes no generic send/on passthrough", () => {
  const preload = fs.readFileSync(path.join(srcDir, "preload.js"), "utf8");
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*send\b/);
  for (const name of ["listApps", "openApp", "showHideApp", "toggleAlwaysOnTop", "getWindowStates", "refreshApps"]) {
    assert.match(preload, new RegExp(name));
  }
});

test("app icon exists and is a PNG", () => {
  const icon = fs.readFileSync(path.join(srcDir, "..", "assets", "app-icon.png"));
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
test("packaging bundles the shared apps directory and targets both Windows formats", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../electron-builder.json", import.meta.url), "utf8"));
  assert.ok(config.extraResources.some((entry) => entry.to === "apps" && entry.from === "../local-launcher/apps"));
  assert.deepEqual(config.win.target, ["nsis", "portable"]);
});
