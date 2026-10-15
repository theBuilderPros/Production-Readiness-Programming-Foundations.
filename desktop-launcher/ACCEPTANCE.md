# Verification record

Date: 2026-10-15. Host: Windows x64. Toolchain: Node 22.17.1, Electron 44.7.2, electron-builder 26.15.3.

## Automated results

- Desktop unit suite: **50 passed**, zero failures. Covers registry validation, traversal and junction escapes, protocol MIME/status handling, state validation/atomic writes, sender/frame and IPC argument checks, navigation/permission policies, lifecycle, per-app window management, packaging configuration, and tray callbacks.
- Existing local-launcher suite: **20 passed**, zero failures; source and test expectations unchanged.
- Real Electron smoke: **passed** using a temporary profile. Launcher loads both current registry entries; Sip opens via `app://local/sip.html`, has no Node or host bridge, ticks, changes interval, resets, and restores localStorage after close/reopen. Duplicate opens create one window. Pin toggle, show/hide, bounds restoration, launcher hide-on-close, second-instance handler, navigation guard, state persistence, and normal quit passed. Screenshots were captured and visually inspected.
- Windows build: **passed**. Produced `dist/Desktop App Launcher Setup 1.0.0.exe` and `dist/Desktop App Launcher 1.0.0.exe` plus installer blockmap.
- Generated portable runtime smoke: **passed**. Launched the actual portable executable in a temporary profile, loaded its bundled registry and Sip, confirmed default pinning and renderer isolation, requested normal application shutdown, and observed process exit. The debugging port was enabled solely by this test invocation.
- Both Sip files retain baseline SHA-256 `D91B84F8771E0EE266AD4D7809CB1B0B72D1568A2F027BD592F850BB623B0DBA`. Browser-extension code, existing package metadata, and tests have no diff.

Commands: `npm test`, `npm run test:smoke`, `npm run dist:win`, `node tools/smoke-package.mjs` from `desktop-launcher/`, and `npm test` from `local-launcher/`. Clear an inherited `ELECTRON_RUN_AS_NODE` variable before real Electron tests. The package smoke test uses Node as an external test driver; that is not a packaged application dependency.

## Manual Windows acceptance

No human-interaction checks were performed. Every manual row remains **not verified**; automated evidence below describes what has been exercised without claiming manual acceptance.

| ID | Manual status | Available automated evidence / remaining check |
| --- | --- | --- |
| W1 | Not verified | Real launcher rendered without a Vite server. |
| W2 | Not verified | Real Sip window opened separately; default pin verified. |
| W3 | Not verified | Requires switching to VS Code/Edge and verifying visibility and typing focus. |
| W4 | Not verified | Real `isAlwaysOnTop()` changed after launcher toggle. |
| W5 | Not verified | Three concurrent renderer requests produced exactly one Sip window. |
| W6 | Not verified | Real bounds/pin restoration passed; off-screen fallback covered by unit tests. Monitor unplug/reconnect remains manual. |
| W7 | Not verified | Real hide/show passed; minimize/restore and tray interaction need a manual walkthrough. |
| W8 | Not verified | Closing real Sip destroyed its window while the launcher remained; renderer closure stops in-page execution. |
| W9 | Not verified | Closing real launcher hid its window; existing-instance handler restored it. Physical tray interaction remains manual. |
| W10 | Not verified | Normal app quit and portable process exit passed. Actual tray Exit click remains manual. |
| W11 | Not verified | Real interval change, water button, countdown, localStorage, and reopen passed. |
| W12 | Not verified | Notification permission scope has unit coverage. Actual notification delivery and chime audibility were not observed. |
| W13 | Not verified | Original 20 tests passed unchanged; browser-extension walkthrough not performed. |
| W14 | Not verified | Built installer and portable; actual portable loaded bundled Sip. Installer execution and offline clean-machine testing without Node are still required. **Packaging acceptance remains unverified.** |
| W15 | Not verified | Traversal/junction/IPC/security unit tests and production navigation-listener smoke passed; manual adversarial navigation remains outstanding. |

## Known limitations

- Electron storage is separate from the browser's Vite origin. All local apps share `app://local` and must use distinct localStorage keys.
- Closing Sip ends its renderer and timer. Sleep/hidden-window scheduling, notification delivery, audible chime, fullscreen overlays, and protected desktops are not guaranteed.
- npm audit reports eight moderate advisories in development-only electron-builder dependencies (the `sprintf-js` logging dependency chain). No production npm dependencies are packaged. These advisories remain unresolved; no forced downgrade or unrelated dependency override was applied.
- Existing user changes were preserved: the modified registry, additional HarnessDemo app, deleted `Spec.txt`, and preexisting untracked specs/reference files. The new host reads the current registry without changing it.
