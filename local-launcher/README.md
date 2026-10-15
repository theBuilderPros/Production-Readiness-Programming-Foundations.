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

Run setup commands from `local-launcher/`. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

Browser permissions and autoplay policy still apply to notifications and audio. Grant notifications using Sip's button; verify the chime in your browser. Future iframe popup mode closes on blur and stops timers; side panel iframe support remains unverified and out of scope.
