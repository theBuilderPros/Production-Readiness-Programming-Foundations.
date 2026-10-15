# Spec: Local App Launcher (Vite + Browser Extension)

## Goal

Plain HTML apps in a local folder are served by `npm run dev`. A small
Chrome/Edge extension lists them and opens them with one click. App HTML
files must work **unmodified**, including inline scripts, `localStorage`,
`Notification` and Web Audio. The first app is the existing `sip.html`.

## Scope of this build (phase 1)

Phase 1 is **window mode only**. `popup` and `sidepanel` modes from the
mode list are phase 2 and are explicitly out of scope for this build. The
`mode` field is still parsed and stored so phase 2 can add behaviour
without a schema change; in phase 1 any non-`window` value falls back to
`window` behaviour.

## Project layout

The project lives in a `local-launcher/` subfolder of the current
repository. `sip.html` is copied into `apps/` unchanged; the original copy
at the repository root is left in place.

```
local-launcher/
├─ package.json
├─ README.md
├─ apps/                  <- served root (Vite root)
│  ├─ apps.json
│  └─ sip.html            <- copied in unchanged
└─ extension/             <- loaded via "Load unpacked"
   ├─ manifest.json
   ├─ launcher.html
   ├─ launcher.js
   ├─ background.js
   └─ icons/              <- 16, 48, 128 png (generated placeholders)
```

Icons are generated placeholder PNGs (16, 48 and 128 px). They satisfy the
manifest and can be replaced later without code changes.

## Dev server

- Dependency: `vite`.
- Script: `"dev": "vite apps --host 127.0.0.1 --port 8765 --strictPort"`.
- Bind to 127.0.0.1 only, so it is not exposed to the LAN.
- `--strictPort` makes it fail rather than change port, because the
  extension hard-codes the address.
- No build step and no framework. Vite is used only as a static server with
  auto-reload.

## `apps/apps.json`

```json
{
  "apps": [
    { "id": "sip", "name": "Sip", "file": "sip.html",
      "mode": "window", "width": 380, "height": 560,
      "description": "Water reminder" }
  ]
}
```

- `mode` is one of `window`, `popup` or `sidepanel`. Default is `window`.
- `width` and `height` apply to `window` mode. Defaults are 400 and 600.
- Adding an app means dropping in an HTML file and adding one entry. No
  extension reload is needed, because the launcher re-fetches this file
  every time it opens.

## Extension (Manifest V3)

- `action.default_popup` is `launcher.html`.
- Permissions: `storage`, plus `sidePanel` if side panel mode is built.
- `host_permissions`: `["http://localhost:8765/*", "http://127.0.0.1:8765/*"]`,
  so it can fetch `apps.json`.
- Background is a service worker, `background.js`.
- Extension pages must not use inline scripts. Everything goes in external
  `.js` files.

### Launcher popup (`launcher.html` and `launcher.js`)

1. On open, fetch `http://127.0.0.1:8765/apps.json`.
2. Render one clickable row per app, showing name and description.
3. On click, send a message to the background worker to open the app.
4. If the fetch fails, show: "Server not running. In the project folder,
   run `npm run dev`." with a Retry button.
5. Style: simple, readable, around 320px wide, with keyboard focus visible.

### Opening modes (`background.js`)

- **window** (build first): `chrome.windows.create({ url, type: "popup",
  width, height })`.
  - If a window for that app is already open, focus it instead of creating
    a second one.
  - Track window IDs in `chrome.storage.session` and verify they still
    exist.
  - Dedup algorithm: on click, read the stored window ID for the app,
    call `chrome.windows.get(id)`; if it resolves, focus it with
    `chrome.windows.update(id, { focused: true })`; if it rejects (the
    window is gone), prune the stale ID and create a new window.
- **popup** (phase 2): the launcher swaps to a view containing an
  `<iframe>` of the app URL. Popups close on blur, so any timer stops.
  Document this limit in the README.
- **sidepanel** (phase 2): the side panel page must be an extension page, so
  it is an `<iframe>` wrapper pointing at the app URL.
- Phase 2 needs a check that iframes of localhost pages are allowed. Vite
  sends no `X-Frame-Options`, but confirm in testing.

## Constraints and known limits (put in README)

- The server must be running. If it is off, apps will not load.
- An app is alive only while its window or panel is open. Closing it stops
  its timers. Persistent background work would need a different extension
  design.
- All apps share the `localhost:8765` origin and therefore share
  `localStorage`. App authors must use unique key names, for example `sip`.
- Load the extension through `chrome://extensions` (or `edge://extensions`),
  turn on Developer mode, then "Load unpacked" and select `extension/`.
  Chrome may show a developer-mode warning on restart.
- Requires Node.js 18 or later.

## Acceptance criteria

1. `npm install && npm run dev` starts the server at
   `http://127.0.0.1:8765`, and `/sip.html` loads.
2. `sip.html` runs with zero edits, with timer, chime, saved settings and
   notifications working.
3. After loading the extension, clicking its icon lists Sip. Clicking Sip
   opens it in a 380x560 standalone window.
4. Clicking Sip again while its window is open focuses that window and does
   not open a duplicate.
5. Adding a second HTML file plus a line in `apps.json` makes it show up on
   the next icon click, with no extension reload.
6. With the server stopped, the launcher shows the "Server not running"
   message.
7. The README documents setup, how to add an app and the limits above.

## Out of scope

- Chrome Web Store publishing.
- Any build step or framework.
- Persistent background timers.
- Syncing across devices.
- `popup` and `sidepanel` opening modes (phase 2).

## Build order

Test window mode first and get it working before attempting popup and side
panel (phase 2). The Edge path `edge://extensions` works the same as
Chrome's.

## Verification

Each acceptance criterion maps to a manual test. Criteria 1, 2, 5 and 6 are
verifiable in a browser against the running dev server. Criteria 3, 4 and 7
require loading the unpacked extension in Chrome or Edge and observing the
behaviour described.
