# Local launcher implementation

Source: docs/superpowers/specs/2026-10-14-local-launcher-design.md
Reference plan: docs/superpowers/plans/2026-10-15-local-launcher.md

- [x] Review spec; scope is phase 1 window mode.
- [x] Scaffold Vite server and copy Sip unchanged.
- [x] Implement registry normalization and window state helpers.
- [x] Implement MV3 worker, icons, and launcher with Retry.
- [x] Document setup and lifecycle limits.
- [x] Run automated tests and verify server.
- [ ] Manually verify loaded extension in Chrome/Edge, chime and notifications.

Referenced Superpowers execution skills are unavailable; implementation follows the documented task sequence directly.

Verification: 20 tests pass with `npm.cmd test` from local-launcher. Vite serves Sip and apps.json on 127.0.0.1:8765. The on-disk Sip copy is byte-identical; served HTML includes Vite live-reload injection. Fixed reference-plan test source path and Windows test discovery command. Worker operations serialize to prevent duplicate windows and storage races.

Manual checks remaining: load extension in Chrome/Edge; inspect 380x560 window, actual focus behavior, timer/chime, saved settings, notification permissions, and add a second app then reopen launcher. Automated mocks cover error/Retry and worker lifecycle.

Dependency installation reports two advisories (one moderate, one high) in the specified Vite 5 dependency tree. No major-version upgrade applied because this build follows the Vite 5 / Node 18 plan.

User confirmed the app works after direct-link and extension setup. Added a comprehensive root README for repository publication, including architecture, schema, setup, tests, troubleshooting, and known limits.
