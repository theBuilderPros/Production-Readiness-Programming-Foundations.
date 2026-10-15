import fs from "node:fs";

export const EMPTY_STATE = { apps: {}, launcher: {} };

function validBounds(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (![x, y, width, height].every(Number.isInteger) || width < 240 || height < 200 || width > 1600 || height > 1200) return null;
  return { x, y, width, height };
}

export function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") return { apps: {}, launcher: {} };
  const apps = {};
  if (raw.apps && typeof raw.apps === "object") {
    for (const [id, value] of Object.entries(raw.apps)) {
      if (!value || typeof value !== "object") continue;
      const entry = {};
      const bounds = validBounds(value.bounds);
      if (bounds) entry.bounds = bounds;
      if (typeof value.alwaysOnTop === "boolean") entry.alwaysOnTop = value.alwaysOnTop;
      if (Object.keys(entry).length) Object.defineProperty(apps, id, { value: entry, enumerable: true, writable: true, configurable: true });
    }
  }
  const launcher = {};
  const launcherBounds = validBounds(raw.launcher?.bounds);
  if (launcherBounds) launcher.bounds = launcherBounds;
  return { apps, launcher };
}

export function readState(filePath, options = {}) {
  const readFileSync = options.readFileSync ?? fs.readFileSync;
  try {
    return sanitizeState(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return { apps: {}, launcher: {} };
  }
}

export function writeState(filePath, state, options = {}) {
  const writeFileSync = options.writeFileSync ?? fs.writeFileSync;
  const renameSync = options.renameSync ?? fs.renameSync;
  const tmp = filePath + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(sanitizeState(state), null, 2));
    renameSync(tmp, filePath);
  } catch (error) {
    try { (options.unlinkSync ?? fs.unlinkSync)(tmp); } catch { /* Nothing to remove. */ }
    throw error;
  }
}

export function isVisibleOnDisplays(bounds, displays) {
  if (!validBounds(bounds) || !Array.isArray(displays)) return false;
  return displays.some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapX > 0 && overlapY > 0;
  });
}

export function resolveBounds(saved, defaults, displays) {
  if (saved && isVisibleOnDisplays(saved, displays)) return saved;
  return defaults;
}

export function centeredBounds(width, height, display) {
  const area = display.workArea;
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}
