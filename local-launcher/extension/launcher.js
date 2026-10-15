import { parseApps } from "./lib/apps-core.js";

const BASE = "http://127.0.0.1:8765/";
const SERVER_ERROR = "Server not running. In the project folder, run `npm run dev`.";

const list = document.getElementById("list");
const errorBox = document.getElementById("error");
const errorMsg = document.getElementById("error-msg");
const retry = document.getElementById("retry");

function showError(text) {
  list.replaceChildren();
  errorBox.hidden = false;
  errorMsg.textContent = text;
}

async function openApp(app) {
  try {
  const response = await chrome.runtime.sendMessage({
    type: "open-app",
    appId: app.id,
    url: BASE + app.file,
    width: app.width,
    height: app.height,
  });
  if (!response?.ok) throw new Error(response?.error || "No response");
  } catch { showError("Unable to open app. Retry to reload the list."); }
}

function render(apps) {
  errorBox.hidden = true;
  const rows = apps.map((app) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = app.name;

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = app.description;

    button.append(name, desc);
    button.addEventListener("click", () => openApp(app));

    const item = document.createElement("li");
    item.append(button);
    return item;
  });
  list.replaceChildren(...rows);
}

async function load() {
  try {
    const response = await fetch(BASE + "apps.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(parseApps(await response.json()));
  } catch {
    showError(SERVER_ERROR);
  }
}

retry.addEventListener("click", load);
load();
