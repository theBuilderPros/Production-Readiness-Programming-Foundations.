# Desktop Launcher (Electron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `desktop-launcher/`, an Electron Windows host that opens the existing `local-launcher/apps/sip.html` in an always-on-top desktop window from the existing `apps.json` registry, with zero edits to the HTML apps and no Vite/Node server at runtime.

**Architecture:** Electron main process owns a privileged `app://local/` protocol restricted to `local-launcher/apps`, a pure registry validator, a per-app window manager, atomic JSON state persistence, a tray, and a narrow named-method IPC bridge used only by the host-owned launcher page. App renderers get no preload and no Node/Electron access.

**Tech Stack:** Electron (stable), Node.js built-in test runner, electron-builder (NSIS + portable), plain HTML/CSS/JS for the launcher page.

**Spec:** `docs/superpowers/specs/2026-10-15-desktop-launcher-design.md`

## Global Constraints

- **Zero edits** to `sip.html` (root and `local-launcher/apps/`), `local-launcher/extension/**`, `local-launcher/package.json`, and existing tests. Phase-1's 20 tests must pass unchanged.
- All paths stay inside `desktop-launcher/` except the root `README.md` link.
- Main process only may use Node/Electron APIs. App renderers get **no preload**; launcher renderer gets only the six named methods via `preload.js`.
- Web preferences everywhere: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`.
- `apps.json` file paths are relative to `local-launcher/apps/`; dimensions clamp to 240–1600 × 240–1200; unknown `mode` → `"window"`.
- App origin is `app://local/<relative-path>`; host must be exactly `local`.
- Persisted state lives at `<userData>/window-state.json`; writes are atomic (temp + rename).
- Do not store Sip's reminder/hydration values in Electron state.
- **Git precondition:** this checkout has a `dubious ownership` git error. Before committing, run once: `git config --global --add safe.directory D:/TheBuilderProsMaster/BeginnerTeasers`. If your human partner does not want commits, skip the commit steps.
- Run all `desktop-launcher` commands with `workdir` set to `desktop-launcher`; use `npm.cmd` if PowerShell blocks `npm.ps1`.

## Review Focus

1. Corrupt/garbage `window-state.json` (truncated JSON, wrong types) → launcher starts with defaults, never crashes (Task 3).
2. `apps.json` entry with encoded traversal (`%2e%2e%2f`) or an absolute path (`C:\Windows\...`) → rejected by the registry and 403 by the protocol handler (Tasks 1, 2).
3. Saved bounds entirely off any connected display (monitor unplugged) → window re-centers on the primary display, never off-screen (Tasks 3, 4).
4. Rapid double-click "Open Sip" → exactly one window (serialized open) (Task 4).
5. Closing the launcher hides to tray while Sip keeps running; **Exit** fully quits; closing Sip stops its timer (Tasks 5, 8).

---

## File Structure

```text
desktop-launcher/
  package.json                 # scripts, deps, electron-builder config block
  electron-builder.json        # packaging config (bundles ../local-launcher/apps)
  src/
    registry.js                # validation + safe path resolution (pure; shared with protocol)
    protocol.js                # app:// URL parsing + request resolution (pure; electron-free)
    state.js                   # window-state persistence + bounds visibility (pure)
    lifecycle.js               # hide-to-tray vs quit flag (pure)
    windows.js                 # per-app window manager (deps injected)
    launcher-ipc.js            # named IPC handlers (deps injected)
    tray.js                    # tray construction (Thin; uses injected electron bits)
    main.js                    # Electron bootstrap: protocol, lifecycle, single instance, tray
    preload.js                 # contextBridge, launcher windows only
    launcher.html              # launcher markup + CSP
    launcher.js                # launcher renderer logic
  assets/
    app-icon.png               # generated dependency-free PNG
  tests/
    registry.test.js
    protocol.test.js
    state.test.js
    lifecycle.test.js
    windows.test.js
    launcher-ipc.test.js
    static-assets.test.js
```

Shared contracts (locked here; every task uses these exact names):

- `registry.js`: `DEFAULT_WIDTH=400`, `DEFAULT_HEIGHT=600`, `MIN_WIDTH=240`, `MAX_WIDTH=1600`, `MIN_HEIGHT=240`, `MAX_HEIGHT=1200`, `VALID_MODES`, `clampDimension(value, fallback, min, max) → number`, `normalizeApp(entry) → app` (throws), `resolveAppPath(rootDir, file) → string|null` (string-level), `resolveAppPathReal(rootDir, file, opts) → string|null` (existence + realpath), `parseRegistry(data, opts) → { apps: App[], byId: Map<string,string> }` (throws), `loadRegistry(registryFile, opts) → { apps, byId }` (throws).
  - `App = { id, name, file, mode, width, height, description, path }` where `path` is the absolute resolved file path.
- `protocol.js`: `MIME_TYPES`, `mimeFor(filePath) → string`, `parseAppUrl(rawUrl) → string|null`, `resolveRequest(rawUrl, opts) → { status, filePath?, mime? }`.
- `state.js`: `sanitizeState(raw) → state`, `readState(filePath, opts) → state`, `writeState(filePath, state, opts) → void`, `isVisibleOnDisplays(bounds, displays) → boolean`, `resolveBounds(saved, defaults, displays) → bounds`, `centeredBounds(width, height, display) → bounds`.
- `lifecycle.js`: `createLifecycle() → { isQuitting(), beginQuit(), shouldHideOnClose(kind) }`.
- `windows.js`: `createWindowManager(deps) → { openApp(app), showHide(id), toggleAlwaysOnTop(id, value?), getWindowStates(), has(id) }`.
- `launcher-ipc.js`: `createHandlers(deps) → { [channel]: handler }`, `CHANNELS`, `installIpc({ ipcMain, handlers, isTrustedSender })`.
- IPC channels: `launcher:list-apps`, `launcher:open-app`, `launcher:show-hide-app`, `launcher:toggle-always-on-top`, `launcher:get-window-states`, `launcher:refresh-apps`, push `launcher:window-states`.
- `state` shape: `{ apps: { [id]: { bounds?: {x,y,width,height}, alwaysOnTop?: boolean } }, launcher: { bounds?: {x,y,width,height} } }`.

---

## Task 1: Scaffold + registry validation

**Files:**
- Create: `desktop-launcher/package.json`
- Create: `desktop-launcher/src/registry.js`
- Create: `desktop-launcher/tests/registry.test.js`
- Create: `desktop-launcher/assets/app-icon.png`

**Interfaces:**
- Produces: everything in `registry.js` listed in File Structure; `npm test` runner.
- Consumes: nothing.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "desktop-launcher",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test",
    "dist:win": "electron-builder --win --config electron-builder.json"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Install pinned toolchain**

Run (workdir `desktop-launcher`): `npm install --save-dev electron@latest electron-builder@latest`
Expected: `node_modules/`, `package-lock.json` created; both packages appear under `devDependencies` with exact `^` ranges.

- [ ] **Step 3: Create the icon generator-free asset**

Write `desktop-launcher/assets/app-icon.png` as a 256×256 PNG. Generate it with a one-off Node script (run from `desktop-launcher`):

```powershell
node -e "const z=require('zlib'),fs=require('fs');const w=256,h=256;const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;for(let x=0;x<w;x++){const o=y*(w*4+1)+1+x*4;raw[o]=0x2b;raw[o+1]=0x8a;raw[o+2]=0xde;raw[o+3]=255;}}function c(t,d){const l=d.length,buf=Buffer.alloc(4+d.length+4);buf.writeUInt32BE(d.length);buf.write(t,4,'ascii');buf.write(t,buf.length-4,'ascii');return buf;}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;const idat=z.deflateSync(raw);const sig=Buffer.from([137,80,78,71,13,10,26,10]);const out=Buffer.concat([sig,c('IHDR',ihdr),c('IDAT',idat),c('IEND',Buffer.alloc(0))]);fs.writeFileSync('assets/app-icon.png',out);"
```

Expected: `assets/app-icon.png` exists and is a valid PNG.

- [ ] **Step 4: Write the failing registry tests**

Create `tests/registry.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  normalizeApp, parseRegistry, loadRegistry, resolveAppPath, resolveAppPathReal,
  DEFAULT_WIDTH, DEFAULT_HEIGHT, MIN_WIDTH, MAX_WIDTH, MIN_HEIGHT, MAX_HEIGHT,
} from "../src/registry.js";

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "apps-"));
fs.writeFileSync(path.join(rootDir, "sip.html"), "<html></html>");

test("normalizeApp fills defaults", () => {
  const app = normalizeApp({ id: "a", name: "A", file: "a.html" });
  assert.deepEqual(app, {
    id: "a", name: "A", file: "a.html", mode: "window",
    width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, description: "",
  });
});

test("normalizeApp keeps explicit values and clamps dimensions", () => {
  const app = normalizeApp({ id: "sip", name: "Sip", file: "sip.html", width: 380, height: 560, description: "Water reminder" });
  assert.equal(app.width, 380);
  assert.equal(app.height, 560);
  assert.equal(app.description, "Water reminder");
  const big = normalizeApp({ id: "b", name: "B", file: "b.html", width: 99999, height: 1 });
  assert.equal(big.width, MAX_WIDTH);
  assert.equal(big.height, MIN_HEIGHT);
});

test("normalizeApp falls back to window for unknown mode and rejects bad entries", () => {
  assert.equal(normalizeApp({ id: "a", name: "A", file: "a.html", mode: "tab" }).mode, "window");
  assert.throws(() => normalizeApp({ name: "A", file: "a.html" }), /id/);
  assert.throws(() => normalizeApp({ id: "a", file: "a.html" }), /name/);
  assert.throws(() => normalizeApp({ id: "a", name: "A" }), /file/);
});

test("resolveAppPath rejects traversal, absolute, and drive paths", () => {
  assert.ok(resolveAppPath(rootDir, "sip.html"));
  assert.equal(resolveAppPath(rootDir, "../secret.html"), null);
  assert.equal(resolveAppPath(rootDir, "..%2fsecret.html"), null);
  assert.equal(resolveAppPath(rootDir, "%2e%2e%2fsecret.html"), null);
  assert.equal(resolveAppPath(rootDir, "..\\secret.html"), null);
  assert.equal(resolveAppPath(rootDir, "C:\\Windows\\win.ini"), null);
  assert.equal(resolveAppPath(rootDir, "/etc/passwd"), null);
});

test("resolveAppPathReal requires an existing file under root", () => {
  assert.ok(resolveAppPathReal(rootDir, "sip.html", {}));
  assert.equal(resolveAppPathReal(rootDir, "missing.html", {}), null);
});

test("parseRegistry accepts the shipped apps.json entry", () => {
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "local-launcher", "apps", "apps.json"), "utf8"));
  const appsRoot = path.resolve(process.cwd(), "..", "local-launcher", "apps");
  const { apps, byId } = parseRegistry(data, { rootDir: appsRoot });
  assert.equal(apps.length, 1);
  assert.equal(apps[0].id, "sip");
  assert.equal(apps[0].width, 380);
  assert.ok(byId.get("sip").endsWith("sip.html"));
});

test("parseRegistry rejects duplicates and missing files", () => {
  assert.throws(() => parseRegistry({ apps: [
    { id: "x", name: "X", file: "sip.html" },
    { id: "x", name: "X2", file: "sip.html" },
  ] }, { rootDir }), /Duplicate/);
  assert.throws(() => parseRegistry({ apps: [{ id: "y", name: "Y", file: "nope.html" }] }, { rootDir }), /missing|outside/);
});

test("parseRegistry rejects a payload without apps array", () => {
  assert.throws(() => parseRegistry(null, { rootDir }), /apps/);
  assert.throws(() => parseRegistry({}, { rootDir }), /apps/);
});

test("loadRegistry reports malformed JSON and missing files", () => {
  const bad = path.join(rootDir, "bad.json");
  fs.writeFileSync(bad, "{ not json");
  assert.throws(() => loadRegistry(bad, {}), /valid JSON/);
  assert.throws(() => loadRegistry(path.join(rootDir, "gone.json"), {}), /not found/);
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run (workdir `desktop-launcher`): `npm test`
Expected: FAIL — `Cannot find module '../src/registry.js'`.

- [ ] **Step 6: Implement `src/registry.js`**

```js
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_WIDTH = 400;
export const DEFAULT_HEIGHT = 600;
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 1600;
export const MIN_HEIGHT = 240;
export const MAX_HEIGHT = 1200;
export const DEFAULT_MODE = "window";
export const VALID_MODES = ["window", "popup", "sidepanel"];

export function clampDimension(value, fallback, min, max) {
  const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function normalizeApp(entry) {
  if (!entry || typeof entry !== "object") throw new Error("App entry must be an object");
  const { id, name, file, description = "" } = entry;
  if (typeof id !== "string" || id.trim() === "") throw new Error("App entry needs a non-empty id");
  if (typeof name !== "string" || name === "") throw new Error(`App "${id}" needs a name`);
  if (typeof file !== "string" || file === "") throw new Error(`App "${id}" needs a file`);
  if (description !== "" && typeof description !== "string") throw new Error(`App "${id}" description must be a string`);

  let mode = entry.mode ?? DEFAULT_MODE;
  if (!VALID_MODES.includes(mode)) mode = DEFAULT_MODE;

  return {
    id,
    name,
    file,
    mode,
    width: clampDimension(entry.width, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
    height: clampDimension(entry.height, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT),
    description,
  };
}

export function resolveAppPath(rootDir, file) {
  if (typeof file !== "string" || file === "") return null;
  let decoded;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    return null;
  }
  if (decoded === "" || decoded.startsWith("/") || decoded.startsWith("\\")) return null;
  if (/^[a-zA-Z]:/.test(decoded)) return null;

  const normalized = path.normalize(decoded);
  if (path.isAbsolute(normalized)) return null;
  if (normalized.split(/[\\/]/).includes("..")) return null;

  const rootResolved = path.resolve(rootDir);
  const full = path.resolve(rootResolved, normalized);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}

export function resolveAppPathReal(rootDir, file, options = {}) {
  const candidate = resolveAppPath(rootDir, file);
  if (!candidate) return null;
  const realpathSync = options.realpathSync ?? fs.realpathSync;
  const statSync = options.statSync ?? fs.statSync;
  try {
    const realRoot = realpathSync(path.resolve(rootDir));
    const realTarget = realpathSync(candidate);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) return null;
    if (!statSync(realTarget).isFile()) return null;
    return realTarget;
  } catch {
    return null;
  }
}

export function parseRegistry(data, options = {}) {
  if (!data || typeof data !== "object" || !Array.isArray(data.apps)) {
    throw new Error('apps.json must contain an "apps" array');
  }
  const apps = [];
  const byId = new Map();
  const seen = new Set();
  for (const raw of data.apps) {
    const app = normalizeApp(raw);
    if (seen.has(app.id)) throw new Error(`Duplicate app id "${app.id}"`);
    seen.add(app.id);
    const fullPath = resolveAppPathReal(options.rootDir, app.file, options);
    if (!fullPath) {
      throw new Error(`App "${app.id}" file "${app.file}" is missing or outside the apps directory`);
    }
    apps.push({ ...app, path: fullPath });
    byId.set(app.id, fullPath);
  }
  return { apps, byId };
}

export function loadRegistry(registryFile, options = {}) {
  const readFileSync = options.readFileSync ?? fs.readFileSync;
  let text;
  try {
    text = readFileSync(registryFile, "utf8");
  } catch {
    throw new Error(`Registry file not found: ${registryFile}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("apps.json is not valid JSON");
  }
  const rootDir = options.rootDir ?? path.dirname(registryFile);
  return parseRegistry(data, { ...options, rootDir });
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS — all registry tests.

- [ ] **Step 8: Verify phase-1 suite is unaffected**

Run (workdir `local-launcher`): `npm test`
Expected: PASS — 20 tests (or the previously passing count), unchanged.

- [ ] **Step 9: Commit**

```bash
git add desktop-launcher/package.json desktop-launcher/package-lock.json desktop-launcher/src/registry.js desktop-launcher/tests/registry.test.js desktop-launcher/assets/app-icon.png desktop-launcher/.gitignore
git commit -m "feat(desktop-launcher): scaffold project and registry validation"
```

Also create `desktop-launcher/.gitignore` containing `node_modules/` and `dist/` before committing.

---

## Task 2: Custom `app://` protocol request resolver

**Files:**
- Create: `desktop-launcher/src/protocol.js`
- Create: `desktop-launcher/tests/protocol.test.js`

**Interfaces:**
- Consumes: `resolveAppPathReal(rootDir, file, opts)` from `registry.js`.
- Produces: `MIME_TYPES`, `mimeFor(filePath)`, `parseAppUrl(rawUrl)`, `resolveRequest(rawUrl, opts) → { status, filePath?, mime? }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/protocol.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { mimeFor, parseAppUrl, resolveRequest } from "../src/protocol.js";

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "proto-"));
fs.writeFileSync(path.join(rootDir, "sip.html"), "<html></html>");
fs.mkdirSync(path.join(rootDir, "assets"));
fs.writeFileSync(path.join(rootDir, "assets", "chime.mp3"), Buffer.from([1, 2, 3]));
fs.writeFileSync(path.join(rootDir, "secret.txt"), "nope");

test("mimeFor maps common extensions", () => {
  assert.equal(mimeFor("a.html"), "text/html");
  assert.equal(mimeFor("a.MP3"), "audio/mpeg");
  assert.equal(mimeFor("a.unknown"), "application/octet-stream");
});

test("parseAppUrl accepts only app://local with a path", () => {
  assert.equal(parseAppUrl("app://local/sip.html"), "sip.html");
  assert.equal(parseAppUrl("app://local/nested/app.html"), "nested/app.html");
  assert.equal(parseAppUrl("app://evil/sip.html"), null);
  assert.equal(parseAppUrl("app://local/"), null);
  assert.equal(parseAppUrl("https://127.0.0.1:8765/sip.html"), null);
  assert.equal(parseAppUrl("file:///C:/x.html"), null);
});

test("resolveRequest serves allowed files with correct mime", () => {
  const r = resolveRequest("app://local/sip.html", { rootDir });
  assert.equal(r.status, 200);
  assert.equal(r.mime, "text/html");
  assert.ok(r.filePath.endsWith("sip.html"));
  const audio = resolveRequest("app://local/assets/chime.mp3", { rootDir });
  assert.equal(audio.mime, "audio/mpeg");
});

test("resolveRequest rejects traversal and non-local hosts", () => {
  assert.equal(resolveRequest("app://local/%2e%2e%2fsecret.txt", { rootDir }).status, 403);
  assert.equal(resolveRequest("app://local/..%2fsecret.txt", { rootDir }).status, 403);
  assert.equal(resolveRequest("app://local/../secret.txt", { rootDir }).status, 403);
  assert.equal(resolveRequest("app://evil/sip.html", { rootDir }).status, 404);
});

test("resolveRequest 404s missing files", () => {
  assert.equal(resolveRequest("app://local/missing.html", { rootDir }).status, 404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir `desktop-launcher`): `npm test`
Expected: FAIL — `Cannot find module '../src/protocol.js'`.

- [ ] **Step 3: Implement `src/protocol.js`**

```js
import fs from "node:fs";
import path from "node:path";
import { resolveAppPathReal } from "./registry.js";

export const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain",
};

export function mimeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function parseAppUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "app:") return null;
  if (url.hostname !== "local") return null;
  const rel = url.pathname.replace(/^\/+/, "");
  if (rel === "") return null;
  return rel;
}

export function resolveRequest(rawUrl, options = {}) {
  const rel = parseAppUrl(rawUrl);
  if (!rel) return { status: 404 };

  const rootDir = options.rootDir;
  const target = resolveAppPathReal(rootDir, rel, options);
  if (!target) {
    const decoded = (() => { try { return decodeURIComponent(rel); } catch { return rel; } })();
    const looksLikeTraversal = decoded.includes("..") || path.isAbsolute(decoded) || /^[a-zA-Z]:/.test(decoded);
    return { status: looksLikeTraversal ? 403 : 404 };
  }
  return { status: 200, filePath: target, mime: mimeFor(target) };
}
```

Note: `resolveAppPathReal` returning `null` for a nonexistent in-root file yields 404; a traversal/absolute path yields 403. The `fs` import is kept for parity with injected-fs tests and is safe to leave in place.

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-launcher/src/protocol.js desktop-launcher/tests/protocol.test.js
git commit -m "feat(desktop-launcher): app:// protocol request resolver"
```

---

## Task 3: Window state persistence + bounds

**Files:**
- Create: `desktop-launcher/src/state.js`
- Create: `desktop-launcher/tests/state.test.js`

**Interfaces:**
- Produces: `sanitizeState(raw)`, `readState(filePath, opts)`, `writeState(filePath, state, opts)`, `isVisibleOnDisplays(bounds, displays)`, `resolveBounds(saved, defaults, displays)`, `centeredBounds(width, height, display)`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Create `tests/state.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  sanitizeState, readState, writeState, isVisibleOnDisplays, resolveBounds, centeredBounds,
} from "../src/state.js";

test("sanitizeState returns empty defaults for garbage", () => {
  assert.deepEqual(sanitizeState(null), { apps: {}, launcher: {} });
  assert.deepEqual(sanitizeState("nope"), { apps: {}, launcher: {} });
  assert.deepEqual(sanitizeState({ apps: { sip: { bounds: { x: "a" } } } }), { apps: {}, launcher: {} });
});

test("sanitizeState keeps valid entries only", () => {
  const state = sanitizeState({
    apps: { sip: { bounds: { x: 1, y: 2, width: 380, height: 560 }, alwaysOnTop: true }, bad: { alwaysOnTop: "yes" } },
    launcher: { bounds: { x: 0, y: 0, width: 420, height: 320 } },
  });
  assert.deepEqual(state.apps.sip, { bounds: { x: 1, y: 2, width: 380, height: 560 }, alwaysOnTop: true });
  assert.equal(state.apps.bad, undefined);
  assert.deepEqual(state.launcher.bounds, { x: 0, y: 0, width: 420, height: 320 });
});

test("readState falls back to defaults on corrupt file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-"));
  const file = path.join(dir, "window-state.json");
  fs.writeFileSync(file, "{ broken");
  assert.deepEqual(readState(file), { apps: {}, launcher: {} });
  assert.deepEqual(readState(path.join(dir, "missing.json")), { apps: {}, launcher: {} });
});

test("writeState is atomic and round-trips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-"));
  const file = path.join(dir, "window-state.json");
  const state = { apps: { sip: { alwaysOnTop: false } }, launcher: {} };
  writeState(file, state);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), state);
  assert.equal(fs.existsSync(file + ".tmp"), false);
});

test("isVisibleOnDisplays detects on/off-screen rectangles", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.equal(isVisibleOnDisplays({ x: 100, y: 100, width: 380, height: 560 }, displays), true);
  assert.equal(isVisibleOnDisplays({ x: 5000, y: 5000, width: 380, height: 560 }, displays), false);
  assert.equal(isVisibleOnDisplays(null, displays), false);
});

test("resolveBounds falls back to defaults when off-screen", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const saved = { x: 4000, y: 4000, width: 380, height: 560 };
  const defaults = { x: 100, y: 100, width: 380, height: 560 };
  assert.deepEqual(resolveBounds(saved, defaults, displays), defaults);
  assert.deepEqual(resolveBounds({ x: 10, y: 10, width: 380, height: 560 }, defaults, displays), { x: 10, y: 10, width: 380, height: 560 });
});

test("centeredBounds centers within a display work area", () => {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  assert.deepEqual(centeredBounds(380, 560, display), {
    x: Math.round((1920 - 380) / 2),
    y: Math.round((1080 - 560) / 2),
    width: 380,
    height: 560,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir `desktop-launcher`): `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/state.js`**

```js
import fs from "node:fs";

export const EMPTY_STATE = { apps: {}, launcher: {} };

function validBounds(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  return { x, y, width, height };
}

export function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") return { apps: {}, launcher: {} };
  const apps = {};
  if (raw.apps && typeof raw.apps === "object") {
    for (const [id, value] of Object.entries(raw.apps)) {
      if (!value || typeof value !== "object") continue;
      const entry = {};
      const bounds = validBounds(value.bounds);
      if (bounds) entry.bounds = bounds;
      if (typeof value.alwaysOnTop === "boolean") entry.alwaysOnTop = value.alwaysOnTop;
      if (Object.keys(entry).length) apps[id] = entry;
    }
  }
  const launcher = {};
  const launcherBounds = validBounds(raw.launcher?.bounds);
  if (launcherBounds) launcher.bounds = launcherBounds;
  return { apps, launcher };
}

export function readState(filePath, options = {}) {
  const readFileSync = options.readFileSync ?? fs.readFileSync;
  try {
    return sanitizeState(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return { apps: {}, launcher: {} };
  }
}

export function writeState(filePath, state, options = {}) {
  const writeFileSync = options.writeFileSync ?? fs.writeFileSync;
  const renameSync = options.renameSync ?? fs.renameSync;
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, filePath);
}

export function isVisibleOnDisplays(bounds, displays) {
  if (!bounds || !Array.isArray(displays)) return false;
  return displays.some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapX > 0 && overlapY > 0;
  });
}

export function resolveBounds(saved, defaults, displays) {
  if (saved && isVisibleOnDisplays(saved, displays)) return saved;
  return defaults;
}

export function centeredBounds(width, height, display) {
  const area = display.workArea;
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-launcher/src/state.js desktop-launcher/tests/state.test.js
git commit -m "feat(desktop-launcher): window state persistence and bounds"
```

---

## Task 4: Per-app window manager

**Files:**
- Create: `desktop-launcher/src/windows.js`
- Create: `desktop-launcher/tests/windows.test.js`

**Interfaces:**
- Consumes: `resolveBounds`, `centeredBounds` from `state.js`.
- Produces: `createWindowManager({ createWindow, getDisplays, getSavedState, saveWindowState }) → { openApp, showHide, toggleAlwaysOnTop, getWindowStates, has }`.
  - `createWindow(app, { bounds, alwaysOnTop }) → BrowserWindowLike` where the fake/real window supports `on`, `isDestroyed`, `isVisible`, `isMinimized`, `restore`, `show`, `hide`, `focus`, `isAlwaysOnTop`, `setAlwaysOnTop`, `getBounds`, `loadURL`.
  - `saveWindowState(id, partial)` merges into the persisted entry.

- [ ] **Step 1: Write the failing tests**

Create `tests/windows.test.js`:

```js
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

test("openApp creates one window and loads the app url", () => {
  const { mgr, created } = setup();
  const win = mgr.openApp(app);
  assert.equal(created.length, 1);
  assert.equal(win.loadedUrl, "app://local/sip.html");
  assert.equal(win.alwaysOnTop, true);
});

test("openApp focuses an existing live window instead of duplicating", () => {
  const { mgr, created } = setup();
  const first = mgr.openApp(app);
  first.focused = false;
  mgr.openApp(app);
  assert.equal(created.length, 1);
  assert.equal(first.focused, true);
});

test("rapid concurrent openApp calls create exactly one window", async () => {
  const { mgr, created } = setup();
  await Promise.all([mgr.openApp(app), mgr.openApp(app), mgr.openApp(app)]);
  assert.equal(created.length, 1);
});

test("a closed window is forgotten and can be reopened", () => {
  const { mgr, created } = setup();
  const first = mgr.openApp(app);
  first.close();
  assert.equal(mgr.has("sip"), false);
  mgr.openApp(app);
  assert.equal(created.length, 2);
});

test("showHide toggles visibility", () => {
  const { mgr } = setup();
  const win = mgr.openApp(app);
  mgr.showHide("sip");
  assert.equal(win.isVisible(), false);
  mgr.showHide("sip");
  assert.equal(win.isVisible(), true);
});

test("toggleAlwaysOnTop flips and persists", () => {
  const { mgr, saved } = setup();
  mgr.openApp(app);
  assert.equal(mgr.toggleAlwaysOnTop("sip"), false);
  assert.equal(saved.sip.alwaysOnTop, false);
  assert.equal(mgr.toggleAlwaysOnTop("sip"), true);
  assert.equal(mgr.toggleAlwaysOnTop("sip", false), false);
});

test("saved off-screen bounds are replaced with visible defaults", () => {
  const saved = { sip: { bounds: { x: 9000, y: 9000, width: 380, height: 560 } } };
  const created = [];
  const mgr = createWindowManager({
    createWindow: (a, opts) => { const w = makeFakeWindow(opts.bounds, opts.alwaysOnTop); created.push(w); return w; },
    getDisplays: () => displays,
    getSavedState: (id) => saved[id] ?? {},
    saveWindowState: () => {},
  });
  mgr.openApp(app);
  assert.ok(created[0].bounds.x < 1920 && created[0].bounds.y < 1080);
});

test("getWindowStates reports tracked windows", () => {
  const { mgr } = setup();
  mgr.openApp(app);
  const states = mgr.getWindowStates();
  assert.equal(states.length, 1);
  assert.deepEqual(states[0], { id: "sip", open: true, visible: true, alwaysOnTop: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir `desktop-launcher`): `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/windows.js`**

```js
import { resolveBounds, centeredBounds } from "./state.js";

export function createWindowManager(deps) {
  const { createWindow, getDisplays, getSavedState, saveWindowState } = deps;
  const open = new Map();
  const chains = new Map();

  function appUrl(app) {
    return `app://local/${app.file}`;
  }

  function persist(id, partial) {
    saveWindowState(id, partial);
  }

  function defaultBounds(app) {
    const displays = getDisplays();
    return centeredBounds(app.width, app.height, displays[0]);
  }

  function openNow(app) {
    const existing = open.get(app.id);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      if (!existing.isVisible()) existing.show();
      existing.focus();
      return existing;
    }
    const saved = getSavedState(app.id) ?? {};
    const bounds = resolveBounds(saved.bounds, defaultBounds(app), getDisplays());
    const win = createWindow(app, { bounds, alwaysOnTop: saved.alwaysOnTop ?? true });
    open.set(app.id, win);
    win.loadURL(appUrl(app));
    win.on("closed", () => {
      open.delete(app.id);
    });
    const snapshot = () => persist(app.id, { bounds: win.getBounds() });
    win.on("move", snapshot);
    win.on("resize", snapshot);
    return win;
  }

  function openApp(app) {
    const previous = chains.get(app.id) ?? Promise.resolve();
    const next = previous.then(() => openNow(app), () => openNow(app));
    chains.set(app.id, next.catch(() => {}));
    return next;
  }

  function showHide(id) {
    const win = open.get(id);
    if (!win || win.isDestroyed()) return null;
    if (win.isVisible()) {
      win.hide();
    } else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    return win.isVisible();
  }

  function toggleAlwaysOnTop(id, value) {
    const win = open.get(id);
    if (!win || win.isDestroyed()) return null;
    const next = typeof value === "boolean" ? value : !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next);
    persist(id, { alwaysOnTop: next });
    return next;
  }

  function getWindowStates() {
    const states = [];
    for (const [id, win] of open.entries()) {
      if (win.isDestroyed()) continue;
      states.push({ id, open: true, visible: win.isVisible(), alwaysOnTop: win.isAlwaysOnTop() });
    }
    return states;
  }

  function has(id) {
    const win = open.get(id);
    return Boolean(win && !win.isDestroyed());
  }

  return { openApp, showHide, toggleAlwaysOnTop, getWindowStates, has };
}
```

Note: `loadURL` in real Electron returns a promise; here it is fire-and-forget, and the window is tracked synchronously before load resolves, which is what prevents duplicate opens.

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-launcher/src/windows.js desktop-launcher/tests/windows.test.js
git commit -m "feat(desktop-launcher): per-app window manager"
```

---

## Task 5: Lifecycle flag

**Files:**
- Create: `desktop-launcher/src/lifecycle.js`
- Create: `desktop-launcher/tests/lifecycle.test.js`

**Interfaces:**
- Produces: `createLifecycle() → { isQuitting(), beginQuit(), shouldHideOnClose(kind) }`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Create `tests/lifecycle.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLifecycle } from "../src/lifecycle.js";

test("hides the launcher on close while not quitting", () => {
  const lc = createLifecycle();
  assert.equal(lc.isQuitting(), false);
  assert.equal(lc.shouldHideOnClose("launcher"), true);
  assert.equal(lc.shouldHideOnClose("app"), false);
});

test("beginQuit stops hiding windows", () => {
  const lc = createLifecycle();
  lc.beginQuit();
  assert.equal(lc.isQuitting(), true);
  assert.equal(lc.shouldHideOnClose("launcher"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir `desktop-launcher`): `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lifecycle.js`**

```js
export function createLifecycle() {
  let quitting = false;
  return {
    isQuitting: () => quitting,
    beginQuit: () => {
      quitting = true;
    },
    shouldHideOnClose: (kind) => kind === "launcher" && !quitting,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-launcher/src/lifecycle.js desktop-launcher/tests/lifecycle.test.js
git commit -m "feat(desktop-launcher): hide-to-tray lifecycle flag"
```

---

## Task 6: IPC handlers + preload bridge

**Files:**
- Create: `desktop-launcher/src/launcher-ipc.js`
- Create: `desktop-launcher/src/preload.js`
- Create: `desktop-launcher/tests/launcher-ipc.test.js`

**Interfaces:**
- Consumes: a registry accessor (`getRegistry() → { apps, byId }` or throws), and window-manager methods.
- Produces: `CHANNELS`, `createHandlers({ getRegistry, windows }) → { [channel]: async (event, arg) => result }`, `installIpc({ ipcMain, handlers, isTrustedSender })`.
- Preload exposes `window.desktopLauncher` with `listApps`, `openApp(id)`, `showHideApp(id)`, `toggleAlwaysOnTop(id)`, `getWindowStates()`, `refreshApps()`, `onWindowStates(cb) → unsubscribe`.

- [ ] **Step 1: Write the failing tests**

Create `tests/launcher-ipc.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir `desktop-launcher`): `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/launcher-ipc.js`**

```js
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

export function createHandlers({ getRegistry, windows }) {
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
      const { apps } = getRegistry();
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
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, arg) => {
      if (!isTrustedSender(event)) return { ok: false, error: "Untrusted sender" };
      return handler(event, arg);
    });
  }
}
```

- [ ] **Step 4: Implement `src/preload.js`**

```js
const { contextBridge, ipcRenderer } = require("electron");

const stateChannel = "launcher:window-states";

contextBridge.exposeInMainWorld("desktopLauncher", {
  listApps: () => ipcRenderer.invoke("launcher:list-apps"),
  openApp: (id) => ipcRenderer.invoke("launcher:open-app", id),
  showHideApp: (id) => ipcRenderer.invoke("launcher:show-hide-app", id),
  toggleAlwaysOnTop: (id) => ipcRenderer.invoke("launcher:toggle-always-on-top", id),
  getWindowStates: () => ipcRenderer.invoke("launcher:get-window-states"),
  refreshApps: () => ipcRenderer.invoke("launcher:refresh-apps"),
  onWindowStates: (callback) => {
    const listener = (_event, states) => callback(states);
    ipcRenderer.on(stateChannel, listener);
    return () => ipcRenderer.removeListener(stateChannel, listener);
  },
});
```

This preload is loaded only on the launcher window. App windows receive no preload, so they cannot reach these methods.

- [ ] **Step 5: Run tests to verify they pass**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop-launcher/src/launcher-ipc.js desktop-launcher/src/preload.js desktop-launcher/tests/launcher-ipc.test.js
git commit -m "feat(desktop-launcher): launcher IPC handlers and preload bridge"
```

---

## Task 7: Launcher UI

**Files:**
- Create: `desktop-launcher/src/launcher.html`
- Create: `desktop-launcher/src/launcher.js`
- Create: `desktop-launcher/tests/static-assets.test.js`

**Interfaces:**
- Consumes: `window.desktopLauncher` methods from Task 6.
- Produces: a static launcher page with CSP; the test locks its contract.

- [ ] **Step 1: Write the failing tests**

Create `tests/static-assets.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (workdir `desktop-launcher`): `npm test`
Expected: FAIL — `launcher.html` missing.

- [ ] **Step 3: Implement `src/launcher.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
  <title>Desktop App Launcher</title>
  <style>
    body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0; padding: 12px; background: #1e1f22; color: #eee; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    h1 { font-size: 15px; margin: 0; font-weight: 600; }
    button { font: inherit; cursor: pointer; }
    #refresh { background: #333; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 4px 10px; }
    #error-banner { display: none; background: #5a1d1d; border: 1px solid #a33; border-radius: 4px; padding: 8px; margin-bottom: 8px; }
    #error-banner.show { display: block; }
    .app-row { border: 1px solid #3a3a3a; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
    .app-name { font-weight: 600; }
    .app-desc { color: #aaa; font-size: 12px; margin: 2px 0 8px; }
    .controls { display: flex; gap: 6px; flex-wrap: wrap; }
    .controls button { background: #2b6cb0; color: white; border: none; border-radius: 4px; padding: 5px 10px; }
    .controls button.secondary { background: #444; }
    .controls button.pinned { background: #2f855a; }
    .empty { color: #888; }
  </style>
</head>
<body>
  <header>
    <h1>Local Apps</h1>
    <button id="refresh" type="button">Refresh</button>
  </header>
  <div id="error-banner" role="alert"></div>
  <div id="app-list"></div>
  <script src="./launcher.js"></script>
</body>
</html>
```

- [ ] **Step 4: Implement `src/launcher.js`**

```js
const api = window.desktopLauncher;
const listEl = document.getElementById("app-list");
const errorEl = document.getElementById("error-banner");
const refreshEl = document.getElementById("refresh");

let apps = [];
let states = new Map();

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.add("show");
}

function clearError() {
  errorEl.textContent = "";
  errorEl.classList.remove("show");
}

function stateFor(id) {
  return states.get(id) ?? { open: false, visible: false, alwaysOnTop: false };
}

function render() {
  listEl.replaceChildren();
  if (apps.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No apps found. Check local-launcher/apps/apps.json.";
    listEl.appendChild(empty);
    return;
  }
  for (const app of apps) {
    const row = document.createElement("div");
    row.className = "app-row";

    const name = document.createElement("div");
    name.className = "app-name";
    name.textContent = app.name;

    const desc = document.createElement("div");
    desc.className = "app-desc";
    desc.textContent = app.description;

    const controls = document.createElement("div");
    controls.className = "controls";
    const state = stateFor(app.id);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = state.open ? "Focus" : "Open";
    openBtn.addEventListener("click", async () => {
      const result = await api.openApp(app.id);
      if (!result?.ok) showError(result?.error ?? "Unable to open app");
      await refreshStates();
    });

    const showBtn = document.createElement("button");
    showBtn.type = "button";
    showBtn.className = "secondary";
    showBtn.textContent = state.visible ? "Hide" : "Show";
    showBtn.disabled = !state.open;
    showBtn.addEventListener("click", async () => {
      await api.showHideApp(app.id);
      await refreshStates();
    });

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = state.alwaysOnTop ? "pinned" : "secondary";
    pinBtn.textContent = state.alwaysOnTop ? "On top: ON" : "On top: OFF";
    pinBtn.disabled = !state.open;
    pinBtn.addEventListener("click", async () => {
      await api.toggleAlwaysOnTop(app.id);
      await refreshStates();
    });

    controls.append(openBtn, showBtn, pinBtn);
    row.append(name, desc, controls);
    listEl.appendChild(row);
  }
}

async function refreshStates() {
  const result = await api.getWindowStates();
  states = new Map((result?.states ?? []).map((s) => [s.id, s]));
  render();
}

async function loadApps(useRefresh) {
  clearError();
  const result = useRefresh ? await api.refreshApps() : await api.listApps();
  if (!result?.ok) {
    apps = [];
    showError(`Could not load apps: ${result?.error ?? "unknown error"}`);
    render();
    return;
  }
  apps = result.apps;
  await refreshStates();
}

refreshEl.addEventListener("click", () => loadApps(true));
api.onWindowStates(() => refreshStates());
loadApps(false);
```

- [ ] **Step 5: Run tests to verify they pass**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop-launcher/src/launcher.html desktop-launcher/src/launcher.js desktop-launcher/tests/static-assets.test.js
git commit -m "feat(desktop-launcher): launcher page and renderer"
```

---

## Task 8: Electron bootstrap + tray

**Files:**
- Create: `desktop-launcher/src/tray.js`
- Create: `desktop-launcher/src/main.js`

**Interfaces:**
- Consumes: `loadRegistry`, `resolveRequest`, window manager, state helpers, lifecycle, IPC handlers.
- Produces: a runnable app (`npm start`).

- [ ] **Step 1: Implement `src/tray.js`**

```js
export function buildTrayMenu({ Menu, apps, onShowLauncher, onShowApp, onExit }) {
  const template = [
    { label: "Show Launcher", click: onShowLauncher },
    { type: "separator" },
    ...apps.map((app) => ({ label: `Show ${app.name}`, click: () => onShowApp(app.id) })),
    { type: "separator" },
    { label: "Exit", click: onExit },
  ];
  return Menu.buildFromTemplate(template);
}
```

- [ ] **Step 2: Implement `src/main.js`**

```js
import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, protocol, screen } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "./registry.js";
import { resolveRequest } from "./protocol.js";
import { readState, writeState, centeredBounds } from "./state.js";
import { createLifecycle } from "./lifecycle.js";
import { createWindowManager } from "./windows.js";
import { CHANNELS, createHandlers, installIpc } from "./launcher-ipc.js";
import { buildTrayMenu } from "./tray.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isPackaged = app.isPackaged;

function appsRoot() {
  return isPackaged
    ? path.join(process.resourcesPath, "apps")
    : path.resolve(__dirname, "..", "..", "local-launcher", "apps");
}

function registryFile() {
  return path.join(appsRoot(), "apps.json");
}

let launcherWindow = null;
let tray = null;
let registry = { apps: [], byId: new Map() };
let windowManager = null;
const lifecycle = createLifecycle();

let stateFile = "";
let state = { apps: {}, launcher: {} };

function persistState() {
  try {
    writeState(stateFile, state);
  } catch (error) {
    console.error("Failed to write window state:", error);
  }
}

function reloadRegistry() {
  registry = loadRegistry(registryFile());
  return registry;
}

function sendWindowStates() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.webContents.send("launcher:window-states", windowManager.getWindowStates());
  }
}

function createLauncherWindow() {
  const saved = state.launcher.bounds;
  const displays = screen.getAllDisplays();
  const defaultBounds = centeredBounds(420, 320, screen.getPrimaryDisplay());
  const bounds = saved && displays.length ? saved : defaultBounds;

  launcherWindow = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 200,
    title: "Desktop App Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  launcherWindow.removeMenu();
  launcherWindow.loadFile(path.join(__dirname, "launcher.html"));

  launcherWindow.on("close", (event) => {
    if (lifecycle.shouldHideOnClose("launcher")) {
      event.preventDefault();
      launcherWindow.hide();
    }
  });

  const saveBounds = () => {
    if (!launcherWindow || launcherWindow.isDestroyed()) return;
    state.launcher.bounds = launcherWindow.getBounds();
    persistState();
  };
  launcherWindow.on("move", saveBounds);
  launcherWindow.on("resize", saveBounds);

  launcherWindow.on("closed", () => {
    launcherWindow = null;
  });
}

function showLauncher() {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    createLauncherWindow();
    return;
  }
  if (launcherWindow.isMinimized()) launcherWindow.restore();
  launcherWindow.show();
  launcherWindow.focus();
}

function createAppWindow(app_, options) {
  const win = new BrowserWindow({
    ...options.bounds,
    minWidth: 240,
    minHeight: 240,
    title: app_.name,
    alwaysOnTop: options.alwaysOnTop,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://local/")) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "notifications");
  });
  win.on("closed", () => sendWindowStates());
  return win;
}

function setupTray() {
  const iconPath = path.join(__dirname, "..", "assets", "app-icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Desktop App Launcher");
  const menu = buildTrayMenu({
    Menu,
    apps: registry.apps,
    onShowLauncher: showLauncher,
    onShowApp: (id) => {
      const found = registry.apps.find((a) => a.id === id);
      if (found) windowManager.openApp(found).then(sendWindowStates);
    },
    onExit: () => {
      lifecycle.beginQuit();
      app.quit();
    },
  });
  tray.setContextMenu(menu);
  tray.on("click", showLauncher);
}

function wireIpc() {
  const handlers = createHandlers({
    getRegistry: () => reloadRegistry(),
    windows: windowManager,
  });
  installIpc({
    ipcMain,
    handlers,
    isTrustedSender: (event) => {
      const sender = event?.sender;
      return Boolean(launcherWindow && sender === launcherWindow.webContents);
    },
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showLauncher());

  app.whenReady().then(() => {
    stateFile = path.join(app.getPath("userData"), "window-state.json");
    state = readState(stateFile);

    protocol.handle("app", async (request) => {
      const result = resolveRequest(request.url, { rootDir: appsRoot() });
      if (result.status !== 200) return new Response(null, { status: result.status });
      try {
        const data = await fs.promises.readFile(result.filePath);
        return new Response(data, { headers: { "content-type": result.mime } });
      } catch {
        return new Response(null, { status: 404 });
      }
    });

    try {
      reloadRegistry();
    } catch (error) {
      console.error("Registry load failed:", error.message);
    }

    windowManager = createWindowManager({
      createWindow: createAppWindow,
      getDisplays: () => screen.getAllDisplays(),
      getSavedState: (id) => state.apps[id] ?? {},
      saveWindowState: (id, partial) => {
        state.apps[id] = { ...(state.apps[id] ?? {}), ...partial };
        persistState();
        sendWindowStates();
      },
    });

    wireIpc();
    createLauncherWindow();
    setupTray();
  });

  app.on("before-quit", () => lifecycle.beginQuit());
  app.on("window-all-closed", () => {
    if (lifecycle.isQuitting()) app.quit();
  });
}
```

Note: `createAppWindow` matches the `createWindow(app, options)` contract from Task 4 and returns the window without loading the URL (the manager calls `loadURL`). `getSavedState`/`saveWindowState` read and write `state.apps`.

- [ ] **Step 3: Type-check imports by running the app**

Run (workdir `desktop-launcher`): `npm start`
Expected: an always-on-top-able Sip window opens; launcher lists Sip; no Vite server needed. Close the app window via the launcher or tray. (Manual; do not claim notification/audio behavior yet.)

- [ ] **Step 4: Run the unit suite**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-launcher/src/tray.js desktop-launcher/src/main.js
git commit -m "feat(desktop-launcher): Electron bootstrap, tray, and wiring"
```

---

## Task 9: Packaging with electron-builder + docs

**Files:**
- Create: `desktop-launcher/electron-builder.json`
- Create: `desktop-launcher/README.md`
- Modify: `README.md` (root) — append a "Desktop host (phase 2)" section only.

**Interfaces:**
- Consumes: `npm start`, `appsRoot()` from Task 8.
- Produces: `npm run dist:win` artifacts under `desktop-launcher/dist/`.

- [ ] **Step 1: Create `electron-builder.json`**

```json
{
  "appId": "com.thebuilderpros.desktoplauncher",
  "productName": "Desktop App Launcher",
  "directories": {
    "output": "dist"
  },
  "files": [
    "src/**/*",
    "assets/**/*",
    "package.json"
  ],
  "extraResources": [
    { "from": "../local-launcher/apps", "to": "apps" }
  ],
  "win": {
    "icon": "assets/app-icon.png",
    "target": ["nsis", "portable"]
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

`extraResources` copies `local-launcher/apps` to `<install>/resources/apps`, which is exactly the path `appsRoot()` reads in a packaged build.

- [ ] **Step 2: Add a packaging smoke test to the suite**

Append to `tests/static-assets.test.js`:

```js
test("electron-builder config bundles the shared apps directory", () => {
  const config = JSON.parse(fs.readFileSync(path.join(srcDir, "..", "electron-builder.json"), "utf8"));
  const bundled = config.extraResources.some((entry) => entry.to === "apps" && entry.from.includes("local-launcher/apps"));
  assert.equal(bundled, true);
});
```

- [ ] **Step 3: Run the suite**

Run (workdir `desktop-launcher`): `npm test`
Expected: PASS.

- [ ] **Step 4: Write `desktop-launcher/README.md`**

Include, at minimum: install (`npm ci`), run (`npm start`), build (`npm run dist:win`, artifacts under `dist/`), architecture summary, the **storage-origin note** (`app://local` shares one origin across apps and does not share `localStorage` with `http://127.0.0.1:8765`), limitations (closing Sip stops its timer; no background scheduling; always-on-top is not a privileged overlay; notification/audio behavior verified manually or recorded as unverified), troubleshooting (registry errors, tray hiding, packaged path), and the manual W1–W15 checklist with checkboxes.

- [ ] **Step 5: Append the root README link (no other changes)**

Add a new section near the end of the root `README.md`:

```markdown
## Desktop host (phase 2)

An Electron Windows host for the same apps lives in `desktop-launcher/`. It opens Sip in an always-on-top desktop window without Vite or a browser extension. See `desktop-launcher/README.md`. The Vite + extension workflow above is unchanged.
```

Do not modify any existing line in the root README.

- [ ] **Step 6: Build the Windows package**

Run (workdir `desktop-launcher`): `npm run dist:win`
Expected: installer and portable exe under `desktop-launcher/dist/`. **Label packaging unverified until you actually run the generated exe/installer on Windows and confirm W14.** Do not claim success from the bundler exit code alone.

- [ ] **Step 7: Commit**

```bash
git add desktop-launcher/electron-builder.json desktop-launcher/README.md desktop-launcher/tests/static-assets.test.js README.md
git commit -m "feat(desktop-launcher): packaging config, docs, and root README link"
```

---

## Task 10: Final verification

**Files:**
- No new source files. Optionally add `desktop-launcher/ACCEPTANCE.md` recording manual results.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run both test suites**

Run (workdir `desktop-launcher`): `npm test`
Run (workdir `local-launcher`): `npm test`
Expected: both PASS.

- [ ] **Step 2: Prove the HTML apps are byte-for-byte unchanged**

Run (workdir repo root):

```powershell
Get-FileHash local-launcher/apps/sip.html, sip.html -Algorithm SHA256
git status --short local-launcher/apps/sip.html sip.html local-launcher/extension
```

Expected: `sip.html` files unchanged since before this work; extension paths show no modifications.

- [ ] **Step 3: Walk the manual Windows acceptance table**

Perform W1–W15 from `desktop-launcher/README.md` on Windows. Record each as **passed**, **failed**, or **not verified**. In particular:

- W8: closing Sip stops its countdown; the launcher stays running.
- W9/W10: closing the launcher hides to tray; Exit from the tray quits cleanly.
- W12: verify the chime and Windows notification, or record the exact incompatibility.
- W14: install and run the packaged build with no Node/Vite present, offline.
- W15: attempt `app://local/%2e%2e%2f...` navigation and an external URL, confirm both are blocked.

- [ ] **Step 4: Report using the spec's format**

Report files added/changed, an explicit statement that `sip.html` and the extension are unchanged, run/build instructions, test counts, W1–W15 results (marking unperformed as **not verified**), and remaining known gaps (notifications, audio, packaging, storage-origin differences).
