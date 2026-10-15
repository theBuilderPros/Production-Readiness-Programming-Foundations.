# Desktop Launcher (Electron) — Design Spec

**Date:** 2026-10-15
**Status:** Approved design, adapted from `refSpecs/specv2.md` (baseline)
**Target OS:** Windows 10/11, x64 first
**Primary objective:** Run the existing standalone HTML apps (first: `local-launcher/apps/sip.html`) in a small **always-on-top Windows desktop window** without modifying a single line of the HTML applications.

## 1. Outcome

Create a second host for the repository's existing standalone HTML apps:

- **Existing host (phase 1, unchanged):** Vite at `127.0.0.1:8765` + Chrome/Edge MV3 extension.
- **New host (this project):** Electron Windows launcher at `desktop-launcher/`, installed/run as a desktop program; no Chrome extension, Node/Vite server, or open terminal required **at runtime in a packaged build**.
- A launcher window lists applications from the existing `local-launcher/apps/apps.json` registry; clicking **Sip** opens a separate desktop window.
- Sip's window defaults to **always on top**, remaining visible over ordinary applications after focus moves elsewhere.
- Existing `sip.html` is **shared, never copied or rewritten**. UI and timer logic stay in the HTML app.
- The launcher offers per-app open/focus, show/hide, always-on-top toggle, and clean exit. Closing the launcher window hides it to tray and does not kill running app windows.

**Core constraint: zero edits to `sip.html` and its existing dependencies.** Do not edit the browser-extension implementation, the original root `sip.html`, or existing test expectations to make Electron work.

### Decisions recorded during brainstorming

| Decision | Choice |
| --- | --- |
| Baseline | `refSpecs/specv2.md`, adapted (this document) |
| Scope | Full specv2 MVP in one cycle, including tray and packaging |
| Loading model | Approach A: custom privileged `app://local/` protocol |
| Packaging tool | **electron-builder** (NSIS installer + portable exe) |
| Test runner | Node built-in test runner (consistent with phase 1) |
| Directory name | `desktop-launcher/` |

### Rejected alternatives (with reasons)

- **`file://` direct loading:** near-zero loader code, but per-file opaque origins complicate `localStorage`, weaker security story, and a third origin semantics to reason about. Retained only as a documented last-resort fallback if `app://` presents a demonstrable, unfixable blocker.
- **Embedded loopback server:** closest to phase-1 origin semantics, but keeps a running server inside the packaged app, introduces port conflicts/firewall prompts, and contradicts the "no server at runtime" goal.

## 2. Non-goals

- Not a Windows Widgets Board provider, wallpaper engine, Windows Service, or lock-screen widget.
- Not a browser-extension modification or replacement; both hosts continue working independently.
- No rewriting app UI in React, Vue, Flutter, etc.; no framework required for host or apps.
- No internet-hosted app marketplace, remote URLs, or remote scripts.
- No privileged system-wide overlay: always-on-top applies to ordinary desktop windows, not fullscreen games, UAC/secure desktop, or protected surfaces.
- No exact alarm timing guarantees while Windows sleeps or the Sip window is hidden/closed.
- No background scheduler or OS-level reminder integration; that would be a separate follow-up design.
- No auto-start on Windows logon, auto-update service, account sync, or full-featured tray menu.
- No changes to the `apps.json` schema.
- No file watcher for registry changes; Refresh button only.

## 3. Existing repository contracts

```text
README.md
sip.html                                 # original; do not modify
local-launcher/
  package.json                           # Vite scripts; keep working
  package-lock.json
  apps/
    apps.json                            # shared registry, single source of truth
    sip.html                             # served Sip copy; do not modify
  extension/                             # existing MV3 launcher; do not modify
  tests/                                 # existing tests; must continue to pass
```

Current registry entry (unchanged):

```json
{
  "apps": [
    {
      "id": "sip",
      "name": "Sip",
      "file": "sip.html",
      "mode": "window",
      "width": 380,
      "height": 560,
      "description": "Water reminder"
    }
  ]
}
```

- The JSON `file` path is relative to `local-launcher/apps/`, not the repository root.
- Window dimensions are requested outer window sizes, subject to platform minimums.
- Legacy `popup` and `sidepanel` modes are treated as `window` by this host.

## 4. Proposed structure

```text
desktop-launcher/
  package.json            # electron, electron-builder, dev tooling; pinned via lockfile
  package-lock.json
  README.md               # install, run, architecture, limitations, troubleshooting
  src/
    main.js               # bootstrap: protocol registration, lifecycle, single-instance lock
    registry.js           # load/validate apps.json; safe path resolution (pure)
    protocol.js           # app://local/ handler; only files under local-launcher/apps
    windows.js            # per-app BrowserWindow manager: dedupe, bounds, pin
    state.js              # persist bounds + alwaysOnTop to userData JSON (atomic write)
    tray.js               # notification-area icon + Show Launcher / Show apps / Exit
    launcher.html         # host-owned app-list UI (CSP default-src 'self')
    launcher.js           # renderer; no Node/Electron direct access
    preload.js            # narrow, named-method IPC bridge; launcher windows only
  assets/
    app-icon.png          # tray + packaged-app icon
  tests/
    registry.test.js
    protocol.test.js
    window-manager.test.js
    state.test.js
    lifecycle.test.js
    ipc.test.js
  build/                  # optional electron-builder resources (nsis config, etc.)
```

- `desktop-launcher` may use Node APIs in its **main process** only.
- App renderers must NOT receive Node APIs, Electron APIs, or any preload.
- The shared `local-launcher/apps` directory remains the source of assets in development (no copies); packaging explicitly bundles that directory into the built application.

## 5. Architecture and loading model

### 5.1 No Vite dependency at runtime

Electron serves the static app directory internally. No `npm run dev`, no port 8765, no internet, no Chrome/Edge required. `npm start` works from a checkout; the packaged Windows app runs offline.

### 5.2 Custom privileged `app://local/` protocol (chosen approach)

Register `app` as a **standard, secure, privileged** scheme before app ready via `protocol.registerSchemesAsPrivileged`, then install a `protocol.handle` handler.

Requirements:

- URL shape: `app://local/<relative-path>`. The host must be exactly `local`; any other host returns 404.
- The path is percent-decoded **once**, then validated with the same pure containment resolver used by the registry (see §6). Reject: absolute paths, `..` traversal (plain and encoded), backslash escapes, and symlink escapes (resolved real path must remain under the allowed root). Violations return 403.
- Serve HTML/JS/CSS/images/fonts/audio with an explicit MIME map (at minimum: html, js, css, png, jpg, svg, ico, woff, mp3, wav, ogg).
- No directory listings, no fallback to an unrestricted `file://` handler, no remote redirects.
- All apps share one predictable origin, so normal browser APIs and `localStorage` work; apps must use distinct storage keys (same contract as the Vite host).
- **Storage-origin note:** existing browser storage at `http://127.0.0.1:8765` does not migrate to `app://local`. Separate profiles are expected and must be documented.
- `Notification` and Web Audio behavior must be verified manually on Windows; do not claim parity with Chrome without testing.

**Fallback clause:** if the custom scheme produces a demonstrable, unfixable compatibility blocker with Sip, document the issue and the proposed alternative (candidate: `file://` with known origin caveats) **before** switching. Never modify `sip.html` to accommodate the host.

### 5.3 Process responsibilities

- **Main process:** window creation, registry/path validation, saved window settings, tray, lifecycle, navigation/permission policy.
- **Launcher renderer:** lists local apps and offers controls through a minimal allowlisted preload bridge.
- **App renderer:** runs the original HTML/JS unchanged, isolated from Node/Electron, with **no preload bridge**.

## 6. Registry and path security

`registry.js` reads `local-launcher/apps/apps.json` and produces a validated app list.

Normalization (aligned with phase 1's `apps-core.js`):

- Required non-empty strings: `id`, `name`, `file`.
- Optional: `description` (default `""`), `mode` (unknown → `window`), `width` (default 400), `height` (default 600).
- Dimensions clamped to 240–1600 × 240–1200.

Electron-specific hardening (stricter than phase 1):

- **Reject** (do not silently drop): duplicate IDs, absolute paths, `..` traversal (plain and percent-encoded), backslash escapes, non-string types for known fields, and entries whose resolved file does not exist on disk.
- Malformed JSON or missing registry → the launcher shows an actionable error ("apps.json is missing or invalid — fix it, then Refresh"); never crash-to-desktop.

Path resolution is a **pure, injectable** function `(rootDir, file) → absolutePath | null` that:

1. Percent-decodes once and rejects double-encoding tricks.
2. Normalizes with `path.normalize`.
3. Verifies containment: `resolved === root || resolved.startsWith(root + path.sep)` (after resolving symlinks/real paths).
4. Never trusts renderer-supplied strings — IPC handlers accept only an app ID and consult the trusted id→path map the main process holds.

**Refresh** re-reads the file on demand (button in the launcher). No file watcher in MVP.

**Apps root resolution:** one resolver with two roots — repository checkout points at `../local-launcher/apps` (relative to `desktop-launcher/`); a packaged build points at the bundled copy under `process.resourcesPath`. No duplicated sources in git.

## 7. Functional requirements

### F1. Launcher

- On launch, show a compact launcher with current registry apps (initially Sip).
- Each app row: name, description, **Open / Focus**, **Show / Hide**, **Always on top** toggle reflecting live state; controls may simplify when the window is not running.
- Error states are actionable; no crash on recoverable errors.
- Refresh button reloads the registry; `apps.json` changes during development take effect without restarting Electron.
- No arbitrary file browser, external URL input, or renderer-supplied filesystem paths.

### F2. Window creation and focus

- Clicking Sip once opens **one** BrowserWindow for app ID `sip`, initial bounds ≈ 380×560.
- Clicking again restores/focuses the existing window; never create duplicates. Open requests are serialized through a per-app-ID promise queue so rapid clicks cannot race past map population before the window is tracked.
- Regular decorated, resizable windows (no frameless style, no custom drag bars in MVP).
- Restore saved position/size only if the saved rectangle intersects a connected display's work area (`screen.getAllDisplays()`); otherwise reset to registry size, centered on the primary display.
- Hidden/minimized windows reopen from launcher or tray.
- Handle close/recreation without stale references (`closed` handler removes map entries; never trust a destroyed `BrowserWindow`).

### F3. Always on top

- New app windows default to **alwaysOnTop: ON**.
- Launcher toggle calls `BrowserWindow.setAlwaysOnTop(boolean)` for the tracked window.
- Persist the per-app pin preference; restore on reopen.
- Set the flag once; never re-assert it in a loop or steal foreground keyboard focus.
- Document that OS focus/fullscreen/secure-desktop rules can limit visibility.

### F4. System tray and lifecycle

- Windows notification-area icon with menu: **Show Launcher**, one **Show <App>** entry per registry app, **Exit**.
- Closing the **launcher** window hides it to tray; the process stays alive while any windows (or the tray) remain.
- Closing an **app** window really closes its renderer and stops its in-page timer. Explicit limitation — not background scheduling.
- **Exit** (tray menu or app quit) closes all windows and terminates cleanly. An `isQuitting` flag prevents hide-to-tray during quit and prevents window recreation during session end.
- Single-instance lock: a second launch focuses the existing launcher instead of opening a second process.

### F5. Persisted window preferences

Persist only Electron-owned values in `<userData>/window-state.json`:

```json
{
  "apps": {
    "sip": {
      "bounds": { "x": 10, "y": 10, "width": 380, "height": 560 },
      "alwaysOnTop": true
    }
  },
  "launcher": { "bounds": { "x": 100, "y": 100, "width": 420, "height": 320 } }
}
```

- Atomic writes (temp file + `fs.rename`); validate on read; defaults on corruption; never crash on a bad state file.
- Save on window `move`/`resize` (debounced) and on close/quit.
- Do **not** store Sip's hydration/reminder values here; Sip owns those via `localStorage`.

### F6. Sip compatibility checks (no source changes)

Verify on Windows without altering `sip.html`:

- Main UI renders; countdown updates.
- Changing the reminder interval works.
- "I drank some water" resets the cycle.
- Reload/reopen preserves interval and deadline within Electron's own app origin/profile.
- Notification prompt/permission and Windows notification work, or the failure is documented explicitly (never silently faked).
- Chime plays after user interaction, subject to autoplay/device policy.
- Window stays pinned over VS Code/Edge after switching focus, without stealing typing focus.

## 8. Security requirements — mandatory

Use a current stable Electron version compatible with the chosen Node toolchain; follow Electron's official security recommendations.

BrowserWindow webPreferences (both launcher and app windows):

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`.
- Remote module, `allowRunningInsecureContent`, and `webview` tags remain disabled.

IPC:

- Preload exposes **only** named methods: `listApps`, `openApp`, `showHideApp`, `toggleAlwaysOnTop`, `getWindowStates`, `refreshApps`, plus one `onWindowStates` subscription. No generic `send(channel, payload)` passthrough.
- App windows receive **no preload at all**.
- Validate the IPC sender frame and every app ID against the trusted registry map; never accept renderer-supplied URLs or paths.

Navigation and content policy (app windows):

- Allow only `app://local/...` top-level navigations (`will-navigate`); deny everything else.
- `setWindowOpenHandler` → deny for all app windows.
- Downloads denied; `will-attach-webview` denied.

Permissions:

- Scoped permission handler: grant `notifications` only (matching Sip's explicit user-gesture flow); deny all other permission requests. Document the UX and verify actual compatibility.
- Audio autoplay follows Electron defaults.

Host pages:

- CSP `default-src 'self'` on launcher pages.
- Never weaken Sip's runtime or edit Sip source to suppress security warnings; assess CSP interaction carefully if a CSP is ever applied to app windows (MVP: none applied to app content).

General:

- No shell execution, arbitrary filesystem read/write, or OS command bridge for loaded HTML apps.
- No untrusted registry content, no remote origins through the custom protocol.

## 9. Build and development commands

Scripts in `desktop-launcher/package.json`:

```text
npm ci                # install pinned dependencies from lockfile
npm start             # launch Electron from a repository checkout
npm test              # headless unit tests (Node built-in runner)
npm run dist:win      # electron-builder: NSIS installer + portable exe
```

- Packaging: **electron-builder**, direct dependency versions pinned via lockfile.
- Package application assets and icons correctly; the packaged app must not reference paths that exist only in the source checkout (apps root switches via the resolver in §6).
- **Acceptance of packaging is conditional on actually running the generated installer/executable on Windows.** A successful bundler exit status is not acceptance; until verified, label packaging **unverified**.

## 10. Testing requirements

### Automated (headless, no real Electron required for unit tests)

Pure modules are tested directly; Electron APIs (BrowserWindow, screen, fs side effects) are mocked/faked via dependency injection.

1. Registry accepts the existing `apps.json` entry and supported optional fields.
2. Registry rejects malformed JSON, empty/duplicate IDs, unsafe paths, traversal (plain and encoded), escaping symlinks, and missing files; clamps out-of-range dimensions.
3. Protocol path resolver serves only files under the allowed root and maps correct MIME types; rejects escapes.
4. Unsupported/invalid renderer IPC requests and unknown senders are rejected.
5. No duplicate windows on rapid repeat activation (mocked BrowserWindow).
6. Closed/destroyed windows are tracked correctly and permit a new open.
7. Always-on-top toggle persists per app.
8. Saved off-screen bounds are repositioned safely.
9. Lifecycle distinguishes hide-to-tray from full quit (flag-based test).
10. Corrupt state JSON falls back to defaults; atomic write produces a valid file.
11. Existing `local-launcher` tests still pass **unchanged**.

### Manual Windows acceptance (W1–W15)

| ID | Action | Expected result |
| --- | --- | --- |
| W1 | `npm start` | Launcher appears; no Vite server required |
| W2 | Open Sip | Separate ≈380×560 window opens |
| W3 | Switch focus to VS Code/Edge | Sip stays visible on top without stealing typing focus |
| W4 | Toggle Always on top OFF/ON | Pinning changes immediately |
| W5 | Click Open Sip repeatedly | One tracked Sip window, focused/revealed |
| W6 | Move/resize Sip, close/reopen | Bounds and pin preference restored on a visible screen |
| W7 | Minimize/hide then restore | Window restores via launcher/tray |
| W8 | Close Sip | Sip's UI/timer stops; launcher remains running |
| W9 | Close launcher | Tray remains; Show Launcher works |
| W10 | Quit from tray | Process exits cleanly |
| W11 | Change Sip interval; click water button; reopen | Existing Sip operations and saved data work within the Electron profile |
| W12 | Test chime and Windows notification | Results accurately verified or incompatibility recorded |
| W13 | Run Vite + Chrome extension separately | Existing workflow unchanged |
| W14 | Install/run packaged Windows build with no Node/terminal/Vite | Bundled Sip opens offline with same behavior |
| W15 | Attempt traversal / unauthorized remote navigation | Blocked; no filesystem escape or privileged access |

## 11. Implementation order

1. Inspect repository state; never overwrite user changes.
2. Registry validation + safe path resolution + tests.
3. Custom local protocol + path resolver tests.
4. Electron lifecycle, launcher UI, narrowly scoped preload bridge.
5. Per-app window manager: dedupe, pinning, bounds persistence + tests.
6. Windows tray menu and predictable close/quit behavior.
7. Packaging: electron-builder config, bundling of shared `local-launcher/apps` assets.
8. Run new and original automated test suites; conduct/record manual Windows checks.
9. Write `desktop-launcher/README.md` (install, startup, architecture, limitations, troubleshooting, storage-origin note). Add a short "Desktop host" paragraph + link to the root README **without changing prior instructions**.

## 12. Definition of done

- `desktop-launcher/` exists with runnable source, lockfile, tests, README, and Windows packaging configuration.
- `local-launcher/apps/sip.html` and the original root `sip.html` are byte-for-byte unchanged.
- The existing Chrome/Edge Vite extension remains functional.
- Electron opens Sip in a persistently pinnable normal Windows window with no Vite server required.
- All automatable tests in §10 pass; manual results are reported as **passed**, **failed**, or **not verified** — never assumed.
- No security controls were disabled to make the HTML work.
- The packaged executable/installer includes local apps and works offline; if not tested on Windows, packaging is labeled **unverified**.
- No claim that Sip reminders run after its window is closed; background scheduling is explicitly deferred.

## 13. Report format after implementation

1. Files added/changed, with an explicit statement confirming `sip.html` and browser-extension files are unchanged.
2. How to run (`cd desktop-launcher`, `npm ci`, `npm start`).
3. How to build the Windows package and where artifacts are output.
4. Automated test counts/results, including the original phase-1 suite.
5. Manual Windows acceptance results W1–W15, marking unperformed checks **not verified**.
6. Remaining known gaps (especially notifications, audio, packaging, and storage-origin differences).

## References

- Baseline spec: `refSpecs/specv2.md`
- Phase 1 design: `docs/superpowers/specs/2026-10-14-local-launcher-design.md`
- Existing repository README, `local-launcher/package.json`, registry, and MV3 implementation
- Electron BrowserWindow: https://www.electronjs.org/docs/latest/api/browser-window
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron protocol: https://www.electronjs.org/docs/latest/api/protocol
