import fs from "node:fs";
import path from "node:path";

export const DEFAULT_WIDTH = 400;
export const DEFAULT_HEIGHT = 600;
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 1600;
export const MIN_HEIGHT = 240;
export const MAX_HEIGHT = 1200;
export const DEFAULT_MODE = "window";
export const VALID_MODES = ["window", "popup", "sidepanel"];

export function clampDimension(value, fallback, min, max) {
  const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function normalizeApp(entry) {
  if (!entry || typeof entry !== "object") throw new Error("App entry must be an object");
  const { id, name, file, description = "" } = entry;
  if (typeof id !== "string" || id.trim() === "") throw new Error("App entry needs a non-empty id");
  if (typeof name !== "string" || name === "") throw new Error(`App "${id}" needs a name`);
  if (typeof file !== "string" || file === "") throw new Error(`App "${id}" needs a file`);
  if (description !== "" && typeof description !== "string") throw new Error(`App "${id}" description must be a string`);
  if (!name.trim() || !file.trim()) throw new Error("App name and file cannot be blank");
  for (const field of ["mode", "width", "height"]) {
    if (entry[field] === undefined) continue;
    const expected = field === "mode" ? "string" : "number";
    if (typeof entry[field] !== expected || (expected === "number" && !Number.isFinite(entry[field]))) {
      throw new Error(`App "${id}" ${field} must be a finite ${expected}`);
    }
  }

  let mode = entry.mode ?? DEFAULT_MODE;
  if (!VALID_MODES.includes(mode)) mode = DEFAULT_MODE;

  return {
    id,
    name,
    file,
    mode: "window",
    width: clampDimension(entry.width, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
    height: clampDimension(entry.height, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT),
    description,
  };
}

export function resolveAppPath(rootDir, file) {
  if (typeof file !== "string" || file === "") return null;
  let decoded;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    return null;
  }
  // Validate before normalization can erase traversal segments.
  if (!decoded || /[%\\:\x00-\x1f?#]/.test(decoded) || decoded.startsWith("/")) return null;
  if (decoded.split("/").some((segment) => segment === ".." || /[. ]$/.test(segment))) return null;

  const normalized = path.normalize(decoded);
  if (path.isAbsolute(normalized)) return null;
  if (normalized.split(/[\\/]/).includes("..")) return null;

  const rootResolved = path.resolve(rootDir);
  const full = path.resolve(rootResolved, normalized);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}

export function resolveAppPathReal(rootDir, file, options = {}) {
  const candidate = resolveAppPath(rootDir, file);
  if (!candidate) return null;
  const realpathSync = options.realpathSync ?? fs.realpathSync;
  const statSync = options.statSync ?? fs.statSync;
  try {
    const realRoot = realpathSync(path.resolve(rootDir));
    const realTarget = realpathSync(candidate);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) return null;
    if (!statSync(realTarget).isFile()) return null;
    return realTarget;
  } catch {
    return null;
  }
}

export function parseRegistry(data, options = {}) {
  if (!data || typeof data !== "object" || !Array.isArray(data.apps)) {
    throw new Error('apps.json must contain an "apps" array');
  }
  const apps = [];
  const byId = new Map();
  const seen = new Set();
  for (const raw of data.apps) {
    const app = normalizeApp(raw);
    if (seen.has(app.id)) throw new Error(`Duplicate app id "${app.id}"`);
    seen.add(app.id);
    const fullPath = resolveAppPathReal(options.rootDir, app.file, options);
    if (!fullPath) {
      throw new Error(`App "${app.id}" file "${app.file}" is missing or outside the apps directory`);
    }
    apps.push({ ...app, path: fullPath });
    byId.set(app.id, fullPath);
  }
  return { apps, byId };
}

export function loadRegistry(registryFile, options = {}) {
  const readFileSync = options.readFileSync ?? fs.readFileSync;
  let text;
  try {
    text = readFileSync(registryFile, "utf8");
  } catch {
    throw new Error(`Registry file not found: ${registryFile}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("apps.json is not valid JSON");
  }
  const rootDir = options.rootDir ?? path.dirname(registryFile);
  return parseRegistry(data, { ...options, rootDir });
}
