# Desktop launcher implementation plan v2

Source of truth: `docs/superpowers/specs/2026-10-15-desktop-launcher-design.md` and `docs/superpowers/plans/2026-10-15-desktop-launcher.md`.

1. Inspect repository instructions, existing launcher contracts, and the approved desktop design. Record the baseline status and hashes of both Sip files before implementation.
2. Scaffold `desktop-launcher/` with Electron, electron-builder, a pinned dependency lockfile, Node test scripts, and a local application icon. Preserve all existing HTML apps and extension code.
3. Implement and test registry validation and a shared containment resolver, including encoded traversal, duplicate IDs, missing files, and symlink escapes. Resolve development and packaged apps roots centrally.
4. Implement and test the privileged `app://local/` protocol, explicit MIME types, and safe request rejection without a runtime HTTP server.
5. Implement and test validated, atomic window-state persistence, display-aware bounds restoration, and debounced writes.
6. Implement and test the per-app window manager with serialized open requests, focus/restore, show/hide, saved pin preferences, and cleanup of closed or failed windows.
7. Implement and test quit lifecycle, launcher-only IPC with frame validation, and isolated app windows with navigation, popup, download, webview, and permission restrictions.
8. Build the launcher page and narrow preload bridge; wire Electron startup, single-instance handling, tray menu refresh, recoverable registry errors, and clean shutdown.
9. Configure Windows NSIS and portable packaging using the shared apps directory. Document development commands, storage separation, timer limitations, and W1–W15 acceptance checks. Append a desktop-host link to the root README.
10. Install dependencies and run desktop and existing launcher tests. Verify Sip and extension remain unchanged. Build Windows artifacts where supported and record actual manual acceptance results; label unperformed UI, audio, notification, and installed-package checks as not verified.

## Execution notes

- Created this plan before implementation, as requested.
- Initial inspection found no existing `desktop-launcher/` directory.
- Initial sandbox shell execution failed with `helper_unknown_error: setup refresh had errors`; an alternate approved execution path restored access.
- Steps 1–9 implemented in `desktop-launcher/`, including locked dependencies, isolated Electron windows, registry/protocol hardening, tray, state persistence, launcher UI, Windows packaging, and documentation.
- Step 10 automated verification complete: 50 desktop tests and 20 original tests passed; real Electron and actual portable executable smoke checks passed. Both Sip hashes and extension sources remain unchanged.
- NSIS installer and portable executable were generated under `desktop-launcher/dist/`. Manual W1–W15 acceptance, especially cross-app pin visibility, chime/notifications, and clean-machine installation, remains unverified. See `desktop-launcher/ACCEPTANCE.md` for evidence and limits.
