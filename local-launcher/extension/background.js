import { recordWindow, forgetWindow } from "./lib/window-state.js";

const STATE_KEY = "openWindows";
let queue = Promise.resolve();

async function openApp({ appId, url, width, height }) {
  if (typeof appId !== "string" || !appId.trim()) throw new Error("Invalid app ID");
  if (new URL(url).origin !== "http://127.0.0.1:8765") throw new Error("Invalid app origin");
  let state = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY] ?? {};
  const id = Object.hasOwn(state, appId) ? state[appId] : undefined;
  if (id !== undefined) {
    let existing;
    try { existing = await chrome.windows.get(id); } catch { /* Closed window. */ }
    if (existing) {
      await chrome.windows.update(id, { focused: true });
      return { ok: true, action: "focus" };
    }
    state = forgetWindow(state, appId);
    await chrome.storage.session.set({ [STATE_KEY]: state });
  }
  const win = await chrome.windows.create({ url, type: "popup", width, height });
  await chrome.storage.session.set({ [STATE_KEY]: recordWindow(state, appId, win.id) });
  return { ok: true, action: "create" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-app") return;
  // Serialize read/update/write operations, including clicks on different apps.
  const operation = queue.then(() => openApp(message));
  queue = operation.catch(() => {});
  operation.then(sendResponse, error => sendResponse({ ok: false, error: String(error) }));
  return true;
});
