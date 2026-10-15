# Desktop App Launcher

Windows 10/11 x64 desktop host for the HTML apps registered in `../local-launcher/apps/apps.json`. Sip and the browser extension are unchanged. Electron serves the shared apps internally; there is no Vite server, runtime port, or browser-extension dependency.

## Develop and run

Use Node.js 22.12 or newer on Windows:

```powershell
cd desktop-launcher
npm ci
npm start
```

If PowerShell blocks npm scripts, use `npm.cmd`. If an editor terminal sets `ELECTRON_RUN_AS_NODE=1`, clear it for that terminal with `Remove-Item Env:ELECTRON_RUN_AS_NODE` before starting Electron.

The launcher lists every valid registry entry. Open creates a window or focuses its existing window. Show/Hide and On top control a running app. New app windows default to always on top; pin preferences survive close/reopen. Closing the launcher hides it to the notification area. Use the tray's Show Launcher, Show <App>, or Exit menu items. Closing an app closes its renderer.

Refresh reloads the registry and rebuilds the tray menu. Invalid registries show an error with recovery instructions and clear the available app list; fix the file and click Refresh. Already running app windows remain open. Paths in `apps.json` are relative to the shared apps directory, must identify existing files, and cannot escape that directory.

## Test and build

```powershell
npm test
npm run test:smoke
npm run dist:win
```

`npm test` runs headless Node tests with injected Electron fakes. `test:smoke` launches real windows in an isolated temporary profile, exercises the launcher bridge and Sip behavior, saves screenshots under `dist/smoke/`, and quits. It does not verify audible sound, delivered notifications, or visibility over other desktop applications.

`dist:win` uses electron-builder to generate an NSIS installer and portable x64 executable under `dist/`. Development dependencies are pinned in `package-lock.json`. Build tools may download Electron and NSIS on the first build. The packaged application itself runs offline without Node, Vite, npm, or an open terminal. Signing requires a separately configured signing identity; generated local builds have no publisher certificate.

To exercise the generated portable executable with an isolated profile, run `node tools/smoke-package.mjs`. This checks bundled assets and clean exit through a temporary local debugging connection; normal application launches do not enable a debugging port.

The build copies the shared apps directory into `resources/apps`. Development loads the original directory directly; there is no second tracked copy of Sip. Installer and clean-machine acceptance are **not verified** until W14 is completed. See [ACCEPTANCE.md](ACCEPTANCE.md) for actual verification evidence and outstanding manual checks.

## Architecture and security

The main process owns registry validation, protocol handling, window management, persistence, tray, and lifecycle. `app://local/<relative-path>` serves only existing files inside the apps root. Checks reject traversal before normalization, percent-encoding tricks, Windows path escapes, and symlink/junction escapes.

All renderers use sandboxing, context isolation, web security, and disabled Node integration. App windows have no preload. Only the exact launcher main frame can call the six named IPC methods through its narrow bridge. Popups, external navigation, redirects, downloads, and webviews are denied. Only notification permission from tracked local app content can be granted. A user can request it through Sip's water button; actual Windows notification delivery still requires manual verification. Audio uses Electron's default autoplay policy.

Window bounds and pin preferences live in `<userData>/window-state.json` (normally `%APPDATA%/desktop-launcher/`). Writes are debounced and atomically renamed; close/quit flushes pending state. Invalid state falls back to defaults, and off-screen windows recenter on the primary display. Sip owns its own reminder state through browser localStorage.

## Limitations and troubleshooting

- `app://local` is one shared origin across apps. Apps must use distinct storage keys. Existing `http://127.0.0.1:8765` browser data does not migrate; Electron uses its own profile.
- Closing Sip stops its in-page timer. This host does not schedule reminders after close or guarantee timing while hidden, minimized, or Windows is asleep.
- Always on top applies to ordinary desktop windows. Fullscreen applications, UAC, and protected desktop surfaces can limit visibility. The host does not repeatedly reassert focus.
- If the launcher seems to disappear, check the notification-area overflow and choose Show Launcher. Exit from that tray menu fully quits.
- For packaged registry problems, inspect the installed `resources/apps/apps.json` and its referenced files. The package must not rely on the source checkout.
- If preferences fail to persist, check that the user profile directory is writable. Corrupt state is ignored; deleting the state file resets host preferences, independently of Sip storage.
- Chime audibility and Windows notification delivery remain **not verified**. Test after clicking Sip's water button and account for device settings, mute state, notification settings, and Focus Assist.

## Manual Windows acceptance checklist

These are manual acceptance checks, independent of automated coverage. Unchecked means **not verified** manually. Record passed/failed evidence in `ACCEPTANCE.md`.

- [ ] W1: `npm start` shows the launcher without Vite.
- [ ] W2: Open Sip; a separate approximately 380 × 560 window opens.
- [ ] W3: Switch to VS Code/Edge; Sip remains on top without stealing typing focus.
- [ ] W4: Toggle always on top off/on; pinning changes immediately.
- [ ] W5: Repeatedly open Sip; one window is focused/revealed.
- [ ] W6: Move/resize, close/reopen; bounds and pin preference restore on a visible display.
- [ ] W7: Minimize/hide, then restore through launcher/tray.
- [ ] W8: Close Sip; its renderer/timer stops and the launcher remains.
- [ ] W9: Close launcher; tray remains and Show Launcher restores it.
- [ ] W10: Exit from the tray; all processes exit cleanly.
- [ ] W11: Change Sip interval, use the water button, reopen; operations and saved data work.
- [ ] W12: Test audible chime and Windows notification delivery; record actual results.
- [ ] W13: Run the Vite + Chrome/Edge extension independently.
- [ ] W14: Install/run the packaged build offline on a Windows machine without Node/Vite/terminal; verify bundled Sip.
- [ ] W15: Attempt traversal and unauthorized remote navigation; both are blocked.

Implementation follows the approved [design](../docs/superpowers/specs/2026-10-15-desktop-launcher-design.md) and [plan](../docs/superpowers/plans/2026-10-15-desktop-launcher.md). Electron guidance: [security](https://www.electronjs.org/docs/latest/tutorial/security), [sandboxed preload behavior](https://www.electronjs.org/docs/latest/tutorial/sandbox), [protocol API](https://www.electronjs.org/docs/latest/api/protocol).
