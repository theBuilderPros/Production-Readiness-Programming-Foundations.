# Beginner Teasers: Local App Launcher

Run small, standalone HTML apps locally and launch them from a Chrome or Edge extension. The first app, **Sip**, is a water reminder with a draining glass, countdown, saved settings, chime, and optional desktop notifications.

This repository contains the complete phase 1 implementation: a Vite static development server and a Manifest V3 browser extension. Apps run in ordinary browser windows, so their inline scripts do not need to be rewritten for extension pages.

## Requirements

- Node.js 18 or later and npm, following the original implementation spec.
- Chrome or Chromium-based Microsoft Edge for the extension.
- A terminal that stays open while using the local server.

There is no framework, build step, backend service, database, or account requirement. Vite 5 is the only direct development dependency. The committed lockfile records dependency versions.

## Quick start

From the repository root:

```powershell
cd local-launcher
npm.cmd ci
npm.cmd run dev
```

On terminals without the Windows PowerShell script-policy restriction, `npm ci` and `npm run dev` work as well. `npm install` is also supported; use `npm ci` when reproducing the committed lockfile.

Open **http://127.0.0.1:8765/sip.html**. Keep the server terminal running. Stop it with Ctrl+C.

The bare address **http://127.0.0.1:8765/** has no index page and can return 404. Use the app's full path. You can use Sip directly without installing the extension.

## Install the browser extension

1. Start the server using the steps above.
2. Open `chrome://extensions` or `edge://extensions` in the browser address bar.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select this repository's **local-launcher/extension** directory, which contains `manifest.json`.
6. Optionally pin **Local App Launcher** in the browser toolbar.
7. Click the extension icon. Select **Sip** from the app list.

Sip opens in a standalone popup-type browser window requested at 380 by 560 pixels. These are browser window dimensions, so the content area can be smaller and platform constraints can affect the final size.

Selecting Sip again focuses its existing tracked window. Closing that window allows a new one to be created next time. Developer-mode extension warnings can appear when the browser restarts.

## Using Sip

- The default reminder interval is 90 minutes.
- The glass drains as the countdown approaches zero.
- Change **Remind me every** to reset the countdown with a new interval. The app clamps the interval to at least one minute.
- Click **I drank some water** to refill the glass and start a new cycle.
- That button requests notification permission when permission has not yet been decided.
- When due, Sip changes its message and title, empties the glass, attempts a two-tone chime, and shows a desktop notification if permission has been granted.
- Sip saves the interval and due timestamp in `localStorage` under the key `sip`. Reloading or reopening restores the saved deadline. An expired saved deadline triggers the due state when the app opens again.

Audio depends on the browser's autoplay policy, and notifications depend on browser permission and operating-system settings. Test both in your own browser. Timers can be throttled in background windows; the countdown uses an absolute timestamp but notification delivery is not guaranteed at an exact instant.

The original `sip.html` at the repository root is retained. `local-launcher/apps/sip.html` is a byte-for-byte copy, checked by an automated test. Run the served copy for the intended storage origin and browser API behavior.

## Add another app

1. Put its HTML file and any required relative assets in `local-launcher/apps/`.
2. Add an entry to the `apps` array in `local-launcher/apps/apps.json`.
3. Reopen the extension popup. It fetches the registry every time, so adding an app does not require reloading the extension.

Example registry with two apps:

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
    },
    {
      "id": "notes",
      "name": "Notes",
      "file": "notes.html",
      "mode": "window",
      "width": 400,
      "height": 600,
      "description": "Quick notes"
    }
  ]
}
```

Create `notes.html` before adding that example entry. It is not included in this repository.

| Field | Required | Meaning / default |
| --- | --- | --- |
| `id` | Yes | Nonempty string used to track the app window. Choose a unique ID per app. |
| `name` | Yes | Nonempty string displayed in the launcher. |
| `file` | Yes | Nonempty path relative to `apps/`, such as `notes.html` or `notes/index.html`. |
| `description` | No | Display text below the app name; defaults to an empty string. |
| `mode` | No | `window`, `popup`, or `sidepanel`; defaults to `window`. |
| `width` | No | Requested window width in pixels; defaults to 400 when omitted or nonnumeric. |
| `height` | No | Requested window height in pixels; defaults to 600 when omitted or nonnumeric. |

Use positive integer dimensions accepted by the browser. Use local relative file paths and valid JSON, with no comments or trailing commas. The current parser validates required strings, defaults finite numeric dimensions, and normalizes unknown modes to `window`; it does not validate duplicate IDs or confirm files exist.

Only **window mode** is implemented. `popup` and `sidepanel` values are retained during parsing but currently open the same standalone window. Popup iframe views and side panel integration are phase 2 work.

## Repository structure

```text
.
|-- README.md                         Complete project guide
|-- Spec.txt                          Original brief
|-- sip.html                          Original, unchanged Sip app
|-- stepbystepplan.md                  Implementation checklist and verification notes
|-- docs/superpowers/
|   |-- specs/2026-10-14-local-launcher-design.md
|   `-- plans/2026-10-15-local-launcher.md
`-- local-launcher/
    |-- README.md                     Short launcher guide
    |-- package.json                  npm commands and Vite dependency
    |-- package-lock.json             Locked dependency tree
    |-- apps/
    |   |-- apps.json                 App registry
    |   `-- sip.html                  Served copy of Sip
    |-- extension/
    |   |-- manifest.json             MV3 permissions and entry points
    |   |-- launcher.html             Launcher markup and styling
    |   |-- launcher.js               Fetch, render, click, error, and Retry behavior
    |   |-- background.js             Serialized window creation/focus and session tracking
    |   |-- lib/apps-core.js          Registry validation and normalization
    |   |-- lib/window-state.js       Window state helpers
    |   `-- icons/                    Generated 16, 48, and 128 pixel PNGs
    |-- tests/                        Node unit and mocked integration tests
    `-- tools/make-icons.mjs          Dependency-free PNG icon generator
```

## How it works

1. `npm run dev` runs `vite apps --host 127.0.0.1 --port 8765 --strictPort` from `local-launcher`.
2. Vite serves the `apps/` directory on the loopback interface. It injects its development live-reload client into served HTML; the files on disk remain unchanged.
3. Opening the extension popup fetches `http://127.0.0.1:8765/apps.json` with caching disabled.
4. The launcher normalizes registry entries and creates keyboard-accessible app buttons. Labels use `textContent`.
5. Clicking a button sends an `open-app` message containing the app ID, URL, and dimensions to the extension service worker.
6. The worker accepts URLs on `http://127.0.0.1:8765`, reads its `openWindows` map from `chrome.storage.session`, and checks any saved window ID with `chrome.windows.get`.
7. An existing window is focused. A stale ID is removed before creating and recording a new popup-type window. Operations are serialized to prevent rapid-click duplicates and concurrent storage updates from losing another app's entry.

The service worker can be suspended without losing its browser-session map. A browser restart ends that session; restored or independently opened app windows are not automatically discovered. The direct-link tab and the extension-created window can therefore coexist.

The extension requests `storage` permission and host access to `localhost:8765` and `127.0.0.1:8765`. Its worker is an ES module. Extension JavaScript lives in external files to comply with extension page restrictions. App HTML runs at the local web origin and can keep its own inline scripts.

## Commands and tests

Run these commands inside `local-launcher/`:

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the committed dependency versions. |
| `npm install` | Install dependencies and update the lockfile if necessary. |
| `npm run dev` | Start the fixed-port local server. |
| `npm test` | Run Node's built-in test runner. |
| `npm run icons` | Regenerate the three placeholder extension PNGs. |

Use `npm.cmd` in Windows PowerShell if `npm.ps1` is blocked by execution policy. There is no production build command.

The 20 automated tests cover registry defaults and invalid structures, icon/manifest presence, source-copy equality, pure window state helpers, worker duplicate-click serialization and stale ID recovery, and popup error/retry handling for network, HTTP, JSON, and schema failures. Browser APIs and the popup DOM are mocked in integration tests.

Manual checks complement the tests:

- Open the direct Sip link while the server runs.
- Load the unpacked extension and open Sip; select it again to check focus behavior.
- Close and reopen Sip to check window recreation and saved settings.
- Grant notifications, use a short interval, and verify the due state, chime, and desktop notification.
- Add a second app and confirm it appears when reopening the launcher.
- Stop the server, reopen the launcher, and verify the server error and Retry flow after restarting.

The implementation was verified with 20 passing automated tests and HTTP checks for Sip and the registry. The user subsequently confirmed the app worked. Audio, notification delivery, and real browser behavior still depend on the local environment.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| Root URL shows 404 | Open `/sip.html`; no root index page is provided. |
| Direct app link cannot connect | Start the server from `local-launcher/` and keep its terminal open. |
| Launcher says "Server not running" | Check the server, then inspect `apps.json` for invalid JSON or entries. Fetch and parsing failures use the same message. Click Retry after fixing the issue. |
| Port 8765 is occupied | Stop the process already using the port or reuse the existing launcher server. Strict-port mode deliberately refuses another port. |
| PowerShell blocks `npm.ps1` | Run `npm.cmd` instead. |
| Extension fails to load | Select `local-launcher/extension/`, where `manifest.json` lives. |
| App missing from the list | Save valid `apps.json`, then close and reopen the popup or click Retry. |
| Clicking an app opens a 404 | Confirm the registry's file path matches a file under `apps/`. |
| Launcher says "Unable to open app" | Check file paths and dimensions, reload the extension, and inspect its service worker errors from the browser extensions page. |
| Notification does not appear | Use Sip's button to request permission; check site and operating-system notification settings. |
| No chime | Check mute settings and browser autoplay restrictions; interact with the page before testing. |
| Saved settings look different | Use `127.0.0.1` consistently. `localhost` is a different storage origin. |
| Extension code changes do not appear | Reload the unpacked extension on the browser extensions page. Registry changes alone need no reload. |

## Limits and dependency maintenance

- The server binds to `127.0.0.1` only. This is a local development workflow; it is not a hosted website or LAN service.
- The server must run for apps to load. Closing an app window stops its live timers; the service worker does not run reminders in the background.
- All apps at `http://127.0.0.1:8765` share `localStorage`. Use distinct key names. `localhost` and `127.0.0.1` do not share storage.
- Browser session tracking deduplicates windows opened by the extension, not every tab or restored window at an app URL.
- Phase 2 iframe popup mode would close on blur and stop timers. Side panel iframe compatibility remains to be tested. Neither mode is implemented here.
- There is no Web Store publishing, device synchronization, persistent background scheduler, or production deployment setup.
- The specified Vite 5 dependency installation reported two advisories, one moderate and one high. Review dependency updates before broader use; changing major Vite versions can also change the Node.js requirement. The implementation retains the version family required by the original plan.

## Source documents

- [Original brief](Spec.txt)
- [Phase 1 design spec](docs/superpowers/specs/2026-10-14-local-launcher-design.md)
- [Detailed implementation plan](docs/superpowers/plans/2026-10-15-local-launcher.md)
- [Implementation checklist](stepbystepplan.md)

The phase 1 design spec takes precedence over the earlier brief for scope. In particular, popup and side panel behavior is deferred.
