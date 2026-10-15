# Local App Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vite-served local folder of unmodified HTML apps plus a Chrome/Edge MV3 extension that lists and one-click-opens them in standalone windows.

**Architecture:** Vite runs as a static server only (no framework, no build). The extension popup fetches `apps.json` at open time and messages a background service worker, which opens apps as popup-type windows and deduplicates them using `chrome.storage.session`. Pure logic (JSON parsing/normalisation, window-state resolution) lives in dependency-free ES modules so it can be unit-tested with the Node built-in test runner.

**Tech Stack:** Node.js 18+, Vite 5 (dev server only), Chrome/Edge Manifest V3, `node:test` + `node:assert` for unit tests. No other runtime or dev dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-local-launcher-design.md`

## Global Constraints

- Node.js 18 or later (`"engines": { "node": ">=18" }`).
- The only dependency is `vite`, and it is a `devDependency`. No build step, no framework.
- Dev script is exactly: `vite apps --host 127.0.0.1 --port 8765 --strictPort`.
- Server binds to `127.0.0.1` only; port `8765` is hard-coded in the extension and must not change.
- `sip.html` is copied into `apps/` **unchanged** (byte-for-byte). Never edit it.
- Extension pages use **no inline scripts**; all JS is in external `.js` files.
- `manifest_version` is `3`; permissions are `["storage"]` (phase 1).
- All apps share the `127.0.0.1:8765` origin and therefore `localStorage`; app authors use unique keys (e.g. `sip`).
- Phase 1 is **window mode only**; `popup` and `sidepanel` are phase 2 and must not be implemented.
- Every file path below is relative to `local-launcher/` unless stated otherwise.

> **Git note:** this folder is not currently a git repository. The commit steps below assume one exists; run `git init` inside `local-launcher/` (or the repo root) before Task 1 if you want to use them, otherwise skip the commit steps.

## Review Focus

Inputs/conditions the spec implies but no single task's happy-path test covers by default — each is pinned by a named test in the task shown:

1. `apps.json` is missing, empty, or not valid JSON → launcher must show "Server not running…" (not crash). Pinned in Task 2 (`parseApps` throws on malformed) and Task 5.
2. An entry omits `mode`, `width`, `height`, or `description` → defaults applied (window / 400 / 600 / ""). Pinned in Task 2.
3. `mode` holds an unknown value (e.g. `"tab"`) → falls back to `window` in phase 1. Pinned in Task 2.
4. A stored window id no longer exists (user closed the window) → create a new window and prune the stale id. Pinned in Task 3.
5. The server is up but `apps.json` returns a non-200 or non-JSON body → launcher shows the error state with Retry. Pinned in Task 5.

---

### Task 1: Project scaffold and static server

**Files:**
- Create: `local-launcher/package.json`
- Create: `local-launcher/apps/apps.json`
- Create: `local-launcher/apps/sip.html` (copy of `BeginnerTeasers/sip.html`)
- Create: `local-launcher/tests/static-assets.test.js`
- Create: `local-launcher/.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `apps/apps.json` (the app registry other tasks read) and `npm run dev` / `npm test` scripts.

- [ ] **Step 1: Write the failing test**

`local-launcher/tests/static-assets.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const here = new URL("../", import.meta.url);

test("apps/sip.html is a byte-for-byte copy of the source sip.html", () => {
  const shipped = readFileSync(new URL("apps/sip.html", here));
  const source = readFileSync(new URL("../../sip.html", here));
  assert.ok(shipped.equals(source), "apps/sip.html must match the original");
});

test("apps/apps.json parses and declares an apps array", () => {
  const raw = readFileSync(new URL("apps/apps.json", here), "utf8");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.apps));
  assert.ok(data.apps.length >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (after Step 3 so the runner exists) — or directly `node --test tests/` from `local-launcher/`.
Expected: FAIL with `ENOENT: no such file or directory ... apps/sip.html`.

- [ ] **Step 3: Create the scaffold**

`local-launcher/package.json`

```json
{
  "name": "local-launcher",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite apps --host 127.0.0.1 --port 8765 --strictPort",
    "test": "node --test tests/",
    "icons": "node tools/make-icons.mjs"
  },
  "devDependencies": {
    "vite": "^5.4.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

`local-launcher/apps/apps.json`

```json
{
  "apps": [
    { "id": "sip", "name": "Sip", "file": "sip.html",
      "mode": "window", "width": 380, "height": 560,
      "description": "Water reminder" }
  ]
}
```

`local-launcher/.gitignore`

```
node_modules/
```

Copy the source file unchanged:

```powershell
New-Item -ItemType Directory -Force -Path "apps" | Out-Null
Copy-Item -LiteralPath "..\sip.html" -Destination "apps\sip.html"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/` from `local-launcher/`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the dev server and check acceptance criterion 1**

Run: `npm install`, then `npm run dev`.
Expected: Vite reports `Local: http://127.0.0.1:8765/`. Open `http://127.0.0.1:8765/sip.html` — the Sip timer renders and counts down. Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add local-launcher/package.json local-launcher/package-lock.json local-launcher/.gitignore local-launcher/apps local-launcher/tests/static-assets.test.js
git commit -m "feat: scaffold local-launcher with Vite static server"
```

---

### Task 2: App registry parsing and normalisation

**Files:**
- Create: `local-launcher/extension/lib/apps-core.js`
- Create: `local-launcher/tests/apps-core.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_MODE` (`"window"`), `DEFAULT_WIDTH` (`400`), `DEFAULT_HEIGHT` (`600`), `VALID_MODES` (`["window","popup","sidepanel"]`).
  - `normalizeApp(entry) -> { id, name, file, mode, width, height, description }`; throws `Error` on invalid `id`/`name`/`file`.
  - `parseApps(data) -> NormalizedApp[]`; throws `Error` when `data.apps` is not an array.

- [ ] **Step 1: Write the failing test**

`local-launcher/tests/apps-core.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeApp,
  parseApps,
  DEFAULT_MODE,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
} from "../extension/lib/apps-core.js";

test("normalizeApp fills defaults for omitted optional fields", () => {
  const app = normalizeApp({ id: "a", name: "A", file: "a.html" });
  assert.deepEqual(app, {
    id: "a", name: "A", file: "a.html",
    mode: DEFAULT_MODE, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT,
    description: "",
  });
});

test("normalizeApp keeps explicit values", () => {
  const app = normalizeApp({ id: "sip", name: "Sip", file: "sip.html", mode: "window", width: 380, height: 560, description: "Water reminder" });
  assert.equal(app.width, 380);
  assert.equal(app.height, 560);
  assert.equal(app.description, "Water reminder");
});

test("normalizeApp falls back to window for an unknown mode", () => {
  const app = normalizeApp({ id: "a", name: "A", file: "a.html", mode: "tab" });
  assert.equal(app.mode, "window");
});

test("normalizeApp rejects entries without id, name, or file", () => {
  assert.throws(() => normalizeApp({ name: "A", file: "a.html" }), /id/);
  assert.throws(() => normalizeApp({ id: "a", file: "a.html" }), /name/);
  assert.throws(() => normalizeApp({ id: "a", name: "A" }), /file/);
});

test("parseApps rejects a payload without an apps array", () => {
  assert.throws(() => parseApps(null), /apps/);
  assert.throws(() => parseApps({}), /apps/);
  assert.throws(() => parseApps({ apps: "nope" }), /apps/);
});

test("parseApps normalises every entry", () => {
  const apps = parseApps({ apps: [{ id: "a", name: "A", file: "a.html" }] });
  assert.equal(apps.length, 1);
  assert.equal(apps[0].mode, DEFAULT_MODE);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/apps-core.test.js` from `local-launcher/`
Expected: FAIL with a module-not-found error for `../extension/lib/apps-core.js`.

- [ ] **Step 3: Write the minimal implementation**

`local-launcher/extension/lib/apps-core.js`

```js
export const DEFAULT_MODE = "window";
export const DEFAULT_WIDTH = 400;
export const DEFAULT_HEIGHT = 600;
export const VALID_MODES = ["window", "popup", "sidepanel"];

export function normalizeApp(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("App entry must be an object");
  }
  const { id, name, file, description = "" } = entry;
  if (typeof id !== "string" || id === "") throw new Error("App entry needs a non-empty id");
  if (typeof name !== "string" || name === "") throw new Error(`App "${id}" needs a name`);
  if (typeof file !== "string" || file === "") throw new Error(`App "${id}" needs a file`);

  let mode = entry.mode ?? DEFAULT_MODE;
  if (!VALID_MODES.includes(mode)) mode = DEFAULT_MODE;

  const width = Number.isFinite(entry.width) ? entry.width : DEFAULT_WIDTH;
  const height = Number.isFinite(entry.height) ? entry.height : DEFAULT_HEIGHT;

  return { id, name, file, mode, width, height, description };
}

export function parseApps(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.apps)) {
    throw new Error('apps.json must contain an "apps" array');
  }
  return data.apps.map(normalizeApp);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/apps-core.test.js` from `local-launcher/`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add local-launcher/extension/lib/apps-core.js local-launcher/tests/apps-core.test.js
git commit -m "feat: add apps.json parsing and normalisation"
```

---

### Task 3: Window-state resolution

**Files:**
- Create: `local-launcher/extension/lib/window-state.js`
- Create: `local-launcher/tests/window-state.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `resolveOpen({ state, appId, liveWindowIds }) -> { action: "focus" | "create", windowId?, state }` where `state` is `{ [appId]: windowId }`. On `"create"` the returned `state` has any stale id pruned; on `"focus"` it is returned unchanged.
  - `recordWindow(state, appId, windowId) -> state` (new object with the id recorded).
  - `forgetWindow(state, appId) -> state` (new object with the id removed).

- [ ] **Step 1: Write the failing test**

`local-launcher/tests/window-state.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOpen, recordWindow, forgetWindow } from "../extension/lib/window-state.js";

test("resolveOpen creates when no window is stored", () => {
  const result = resolveOpen({ state: {}, appId: "sip", liveWindowIds: [] });
  assert.equal(result.action, "create");
  assert.deepEqual(result.state, {});
});

test("resolveOpen focuses a live stored window", () => {
  const result = resolveOpen({ state: { sip: 42 }, appId: "sip", liveWindowIds: [7, 42] });
  assert.deepEqual(result, { action: "focus", windowId: 42, state: { sip: 42 } });
});

test("resolveOpen creates and prunes when the stored window is gone", () => {
  const result = resolveOpen({ state: { sip: 42 }, appId: "sip", liveWindowIds: [7] });
  assert.equal(result.action, "create");
  assert.deepEqual(result.state, {});
});

test("recordWindow stores an id without mutating the input", () => {
  const before = { sip: 1 };
  const after = recordWindow(before, "other", 2);
  assert.deepEqual(after, { sip: 1, other: 2 });
  assert.deepEqual(before, { sip: 1 });
});

test("forgetWindow removes an id without mutating the input", () => {
  const before = { sip: 1, other: 2 };
  const after = forgetWindow(before, "sip");
  assert.deepEqual(after, { other: 2 });
  assert.deepEqual(before, { sip: 1, other: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/window-state.test.js` from `local-launcher/`
Expected: FAIL with a module-not-found error for `../extension/lib/window-state.js`.

- [ ] **Step 3: Write the minimal implementation**

`local-launcher/extension/lib/window-state.js`

```js
export function resolveOpen({ state, appId, liveWindowIds }) {
  const stored = state[appId];
  if (stored !== undefined && liveWindowIds.includes(stored)) {
    return { action: "focus", windowId: stored, state };
  }
  const nextState = { ...state };
  if (stored !== undefined) delete nextState[appId];
  return { action: "create", state: nextState };
}

export function recordWindow(state, appId, windowId) {
  return { ...state, [appId]: windowId };
}

export function forgetWindow(state, appId) {
  const next = { ...state };
  delete next[appId];
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/window-state.test.js` from `local-launcher/`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add local-launcher/extension/lib/window-state.js local-launcher/tests/window-state.test.js
git commit -m "feat: add window dedup state resolution"
```

---

### Task 4: Extension manifest, icons, and background worker

**Files:**
- Create: `local-launcher/tools/make-icons.mjs`
- Create: `local-launcher/extension/manifest.json`
- Create: `local-launcher/extension/background.js`
- Create: `local-launcher/tests/extension-static.test.js`
- Generate: `local-launcher/extension/icons/icon16.png`, `icon48.png`, `icon128.png`

**Interfaces:**
- Consumes: `resolveOpen`, `recordWindow` from `./lib/window-state.js`.
- Produces:
  - A service worker listening for `{ type: "open-app", appId, url, width, height }` messages and replying `{ ok: true, action: "focus" | "create" }` or `{ ok: false, error }`.
  - The `extension/icons/*.png` files declared by the manifest.

- [ ] **Step 1: Write the failing test**

`local-launcher/tests/extension-static.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const here = new URL("../", import.meta.url);
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("manifest.json is valid MV3 with the expected keys", () => {
  const manifest = JSON.parse(readFileSync(new URL("extension/manifest.json", here), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, "launcher.html");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.background, { service_worker: "background.js", type: "module" });
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:8765/*"));
});

test("icon files exist and are PNGs", () => {
  for (const size of [16, 48, 128]) {
    const path = new URL(`extension/icons/icon${size}.png`, here);
    assert.ok(existsSync(path), `missing icon${size}.png`);
    const head = readFileSync(path).subarray(0, 8);
    assert.ok(head.equals(PNG_SIG), `icon${size}.png is not a PNG`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/extension-static.test.js` from `local-launcher/`
Expected: FAIL — `ENOENT` for `extension/manifest.json`.

- [ ] **Step 3: Write the icon generator and generate icons**

`local-launcher/tools/make-icons.mjs`

```js
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function solidPng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = r;
    row[2 + x * 4] = g;
    row[3 + x * 4] = b;
    row[4 + x * 4] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(new URL("../extension/icons/", import.meta.url), { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(new URL(`../extension/icons/icon${size}.png`, import.meta.url), solidPng(size, [47, 143, 196]));
}
console.log("wrote icon16.png, icon48.png, icon128.png");
```

Run: `node tools/make-icons.mjs` from `local-launcher/`
Expected: prints `wrote icon16.png, icon48.png, icon128.png`.

- [ ] **Step 4: Write the manifest**

`local-launcher/extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Local App Launcher",
  "version": "1.0.0",
  "description": "Lists and opens apps served by the local Vite dev server.",
  "action": {
    "default_popup": "launcher.html",
    "default_title": "Local Apps"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "permissions": ["storage"],
  "host_permissions": [
    "http://localhost:8765/*",
    "http://127.0.0.1:8765/*"
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 5: Write the background worker**

`local-launcher/extension/background.js`

```js
import { resolveOpen, recordWindow } from "./lib/window-state.js";

const STATE_KEY = "openWindows";

async function getState() {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return stored[STATE_KEY] ?? {};
}

async function setState(state) {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

async function liveWindowIds() {
  const windows = await chrome.windows.getAll();
  return windows.map((w) => w.id);
}

async function openApp({ appId, url, width, height }) {
  let state = await getState();
  const decision = resolveOpen({ state, appId, liveWindowIds: await liveWindowIds() });

  if (decision.action === "focus") {
    await chrome.windows.update(decision.windowId, { focused: true });
    return { ok: true, action: "focus" };
  }

  state = decision.state;
  const win = await chrome.windows.create({ url, type: "popup", width, height });
  state = recordWindow(state, appId, win.id);
  await setState(state);
  return { ok: true, action: "create" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-app") return;
  openApp(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/extension-static.test.js` from `local-launcher/`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add local-launcher/tools/make-icons.mjs local-launcher/extension/manifest.json local-launcher/extension/background.js local-launcher/extension/icons local-launcher/tests/extension-static.test.js
git commit -m "feat: add MV3 manifest, icons, and background window opener"
```

---

### Task 5: Launcher popup

**Files:**
- Create: `local-launcher/extension/launcher.html`
- Create: `local-launcher/extension/launcher.js`

**Interfaces:**
- Consumes: `parseApps` from `./lib/apps-core.js`; the `open-app` message contract from Task 4.
- Produces: the popup UI (rows per app, error state with Retry) referenced by `manifest.action.default_popup`.

- [ ] **Step 1: Write the popup markup**

`local-launcher/extension/launcher.html` — no inline scripts; the styles may be inline.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Local Apps</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; width: 320px; font: 14px/1.4 system-ui, "Segoe UI", sans-serif; color: #12303d; }
    h1 { margin: 0; padding: 12px 14px; font-size: 15px; border-bottom: 1px solid #e6f1f3; }
    ul { list-style: none; margin: 0; padding: 6px; }
    .row { display: block; width: 100%; text-align: left; padding: 10px 12px; border: 0; border-radius: 8px;
           background: transparent; font: inherit; color: inherit; cursor: pointer; }
    .row:hover { background: #e6f1f3; }
    .row:focus-visible { outline: 3px solid #2f8fc4; outline-offset: 2px; }
    .name { display: block; font-weight: 600; }
    .desc { display: block; color: #527080; font-size: 12px; }
    #error { padding: 14px; }
    #error p { margin: 0 0 10px; }
    button#retry { font: inherit; padding: 8px 16px; border: 0; border-radius: 999px; background: #12303d; color: #fff; cursor: pointer; }
    button#retry:focus-visible { outline: 3px solid #2f8fc4; outline-offset: 2px; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <h1>Apps</h1>
  <ul id="list"></ul>
  <div id="error" hidden>
    <p id="error-msg"></p>
    <button id="retry" type="button">Retry</button>
  </div>
  <script type="module" src="launcher.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the popup logic**

`local-launcher/extension/launcher.js`

```js
import { parseApps } from "./lib/apps-core.js";

const BASE = "http://127.0.0.1:8765/";
const SERVER_ERROR = "Server not running. In the project folder, run `npm run dev`.";

const list = document.getElementById("list");
const errorBox = document.getElementById("error");
const errorMsg = document.getElementById("error-msg");
const retry = document.getElementById("retry");

function showError(text) {
  list.replaceChildren();
  errorBox.hidden = false;
  errorMsg.textContent = text;
}

function openApp(app) {
  chrome.runtime.sendMessage({
    type: "open-app",
    appId: app.id,
    url: BASE + app.file,
    width: app.width,
    height: app.height,
  });
}

function render(apps) {
  errorBox.hidden = true;
  const rows = apps.map((app) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = app.name;

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = app.description;

    button.append(name, desc);
    button.addEventListener("click", () => openApp(app));

    const item = document.createElement("li");
    item.append(button);
    return item;
  });
  list.replaceChildren(...rows);
}

async function load() {
  try {
    const response = await fetch(BASE + "apps.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(parseApps(await response.json()));
  } catch {
    showError(SERVER_ERROR);
  }
}

retry.addEventListener("click", load);
load();
```

- [ ] **Step 3: Load the extension and verify acceptance criteria 3, 4, and 6**

1. Ensure `npm run dev` is running.
2. Open `chrome://extensions` (or `edge://extensions`), enable Developer mode, "Load unpacked", select `local-launcher/extension`.
3. Click the extension icon → "Sip" is listed.
4. Click "Sip" → a 380x560 standalone window opens showing the Sip timer (criterion 3).
5. Click "Sip" again → the existing window is focused; no duplicate appears (criterion 4).
6. Close the Sip window, stop the dev server, open the popup again → it shows "Server not running. In the project folder, run `npm run dev`." with a Retry button (criterion 6). Restart the server and click Retry → the list returns.

- [ ] **Step 4: Commit**

```bash
git add local-launcher/extension/launcher.html local-launcher/extension/launcher.js
git commit -m "feat: add launcher popup with error and retry state"
```

---

### Task 6: README and full acceptance pass

**Files:**
- Create: `local-launcher/README.md`

**Interfaces:**
- Consumes: everything built so far.
- Produces: user documentation covering setup, adding an app, and the known limits.

- [ ] **Step 1: Write the README**

`local-launcher/README.md`

```markdown
# Local App Launcher

Run plain HTML apps from a local folder and open them with one click from a
Chrome/Edge extension.

## Requirements

- Node.js 18 or later.
- Chrome or Edge (Chromium).

## Setup

1. Install dependencies: `npm install`
2. Start the server: `npm run dev`
   - Serves `apps/` at http://127.0.0.1:8765 (localhost only).
   - The port is fixed at 8765; the extension hard-codes it.
3. Load the extension:
   - Open `chrome://extensions` (or `edge://extensions`).
   - Turn on **Developer mode**.
   - Click **Load unpacked** and select the `extension/` folder.
   - Chrome may show a developer-mode warning when it restarts.
4. Click the extension icon to see the app list, then click an app to open it.

## Adding an app

1. Drop the HTML file into `apps/`. Leave it unmodified — inline scripts,
   `localStorage`, `Notification` and Web Audio all work.
2. Add one entry to `apps/apps.json`:

   ```json
   { "id": "notes", "name": "Notes", "file": "notes.html",
     "mode": "window", "width": 400, "height": 600,
     "description": "Quick notes" }
   ```

   - `mode` is `window`, `popup` or `sidepanel` (default `window`). Only
     `window` is implemented today.
   - `width`/`height` apply to `window` mode and default to 400x600.
3. Reopen the extension popup. No extension reload is needed — it re-reads
   `apps.json` every time it opens.

## Known limits

- **The server must be running.** If it is off, apps will not load and the
  popup shows a "Server not running" message.
- **An app is alive only while its window is open.** Closing the window
  stops its timers. Persistent background work would need a different
  extension design.
- **All apps share one origin** (`127.0.0.1:8765`) and therefore share
  `localStorage`. Use unique key names per app, for example `sip`.
- `popup` and `sidepanel` modes are not implemented yet.

## Development

- `npm run dev` — start the static server.
- `npm test` — run the unit tests (Node's built-in test runner).
- `npm run icons` — regenerate the placeholder extension icons.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test` from `local-launcher/`
Expected: all test files pass (static assets, apps-core, window-state, extension-static).

- [ ] **Step 3: Walk the acceptance criteria end to end**

With the dev server running and the extension loaded, confirm:

1. `npm install && npm run dev` starts the server at http://127.0.0.1:8765 and `/sip.html` loads.
2. `sip.html` runs unedited: the timer counts down, the chime plays on due, settings persist across reload, and notifications work after granting permission.
3. Clicking the extension icon lists Sip; clicking Sip opens a 380x560 window.
4. Clicking Sip again focuses the existing window (no duplicate).
5. Adding a second HTML file and a line in `apps.json` makes it appear on the next icon click, with no extension reload.
6. With the server stopped, the popup shows the "Server not running" message.
7. The README documents setup, adding an app, and the limits.

- [ ] **Step 4: Commit**

```bash
git add local-launcher/README.md
git commit -m "docs: add README with setup, usage, and limits"
```

---

## Self-Review

**Spec coverage:**

- Goal / unmodified HTML apps → Task 1 (byte-for-byte copy test), Task 5 (external-script popup).
- Project layout → Task 1 (scaffold), Tasks 2-5 (extension tree), Task 4 (icons).
- Dev server (vite, host, port, strictPort) → Task 1 (`package.json` script), Global Constraints.
- `apps.json` schema and defaults → Task 2.
- Extension MV3 (popup, permissions, host_permissions, service worker, no inline scripts) → Task 4 (manifest/background), Task 5 (popup).
- Launcher popup behaviour (fetch, rows, message, error + Retry, styling) → Task 5.
- Window mode + dedup + `storage.session` → Task 3 (logic), Task 4 (glue).
- Popup/sidepanel phase 2 → Global Constraints (explicitly excluded).
- Constraints/limits in README → Task 6.
- Acceptance criteria 1-7 → Task 1 (1), Task 5 (3, 4, 6), Task 6 (2, 5, 7).
- Out of scope → Global Constraints.

**Placeholder scan:** none — every code step contains complete content.

**Type consistency:** `parseApps`/`normalizeApp` signatures match between Task 2 and Task 5; `resolveOpen`/`recordWindow` match between Task 3 and Task 4; the `open-app` message shape (`appId`, `url`, `width`, `height`) is identical in Task 4 and Task 5.

**Review Focus:** each of the five input classes has a named test in the owning task (Tasks 2, 3, 5) as listed in the Review Focus section.
