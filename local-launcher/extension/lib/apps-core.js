export const DEFAULT_MODE = "window";
export const DEFAULT_WIDTH = 400;
export const DEFAULT_HEIGHT = 600;
export const VALID_MODES = ["window", "popup", "sidepanel"];

export function normalizeApp(entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error("App entry must be an object");
  }
  const { id, name, file, description = "" } = entry;
  if (typeof id !== "string" || id === "") throw new Error("App entry needs a non-empty id");
  if (typeof name !== "string" || name === "") throw new Error(`App "${id}" needs a name`);
  if (typeof file !== "string" || file === "") throw new Error(`App "${id}" needs a file`);

  let mode = entry.mode ?? DEFAULT_MODE;
  if (!VALID_MODES.includes(mode)) mode = DEFAULT_MODE;

  const width = Number.isFinite(entry.width) ? entry.width : DEFAULT_WIDTH;
  const height = Number.isFinite(entry.height) ? entry.height : DEFAULT_HEIGHT;

  return { id, name, file, mode, width, height, description };
}

export function parseApps(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.apps)) {
    throw new Error('apps.json must contain an "apps" array');
  }
  return data.apps.map(normalizeApp);
}
