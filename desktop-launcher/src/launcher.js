const api = window.desktopLauncher;
const listEl = document.getElementById("app-list");
const errorEl = document.getElementById("error-banner");
const refreshEl = document.getElementById("refresh");

let apps = [];
let states = new Map();

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.add("show");
}

function clearError() {
  errorEl.textContent = "";
  errorEl.classList.remove("show");
}

function stateFor(id) {
  return states.get(id) ?? { open: false, visible: false, alwaysOnTop: false };
}

function render() {
  listEl.replaceChildren();
  if (apps.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No apps found. Check local-launcher/apps/apps.json.";
    listEl.appendChild(empty);
    return;
  }
  for (const app of apps) {
    const row = document.createElement("div");
    row.className = "app-row";

    const name = document.createElement("div");
    name.className = "app-name";
    name.textContent = app.name;

    const desc = document.createElement("div");
    desc.className = "app-desc";
    desc.textContent = app.description;

    const controls = document.createElement("div");
    controls.className = "controls";
    const state = stateFor(app.id);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = state.open ? "Focus" : "Open";
    openBtn.addEventListener("click", () => perform(() => api.openApp(app.id)));

    const showBtn = document.createElement("button");
    showBtn.type = "button";
    showBtn.className = "secondary";
    showBtn.textContent = state.visible ? "Hide" : "Show";
    showBtn.disabled = !state.open;
    showBtn.addEventListener("click", () => perform(() => api.showHideApp(app.id)));

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = state.alwaysOnTop ? "pinned" : "secondary";
    pinBtn.textContent = state.alwaysOnTop ? "On top: ON" : "On top: OFF";
    pinBtn.setAttribute("aria-pressed", String(state.alwaysOnTop));
    pinBtn.disabled = !state.open;
    pinBtn.addEventListener("click", () => perform(() => api.toggleAlwaysOnTop(app.id)));

    controls.append(openBtn, showBtn, pinBtn);
    row.append(name, desc, controls);
    listEl.appendChild(row);
  }
}

async function refreshStates() {
  const result = await api.getWindowStates();
  if (!result?.ok) throw new Error(result?.error ?? "Unable to read window state");
  states = new Map((result?.states ?? []).map((s) => [s.id, s]));
  render();
}

async function loadApps(useRefresh) {
  clearError();
  const result = useRefresh ? await api.refreshApps() : await api.listApps();
  if (!result?.ok) {
    apps = [];
    showError(`Could not load apps: ${result?.error ?? "unknown error"}`);
    render();
    return;
  }
  apps = result.apps;
  await refreshStates();
}

async function perform(action) {
  try {
    clearError();
    const result = await action();
    if (result && !result.ok) throw new Error(result.error ?? "Unable to update app");
    await refreshStates();
  } catch (error) { showError(error.message); }
}
refreshEl.addEventListener("click", () => perform(() => loadApps(true)));
const unsubscribe = api.onWindowStates((values) => {
  states = new Map(values.map((value) => [value.id, value]));
  render();
});
window.addEventListener("unload", unsubscribe, { once: true });
loadApps(false).catch((error) => showError(error.message));
