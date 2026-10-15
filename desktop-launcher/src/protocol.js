import fs from "node:fs";
import path from "node:path";
import { resolveAppPath, resolveAppPathReal } from "./registry.js";

export const MIME_TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".txt": "text/plain",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
};
export function mimeFor(file) { return MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream"; }

export function parseAppUrl(rawUrl) {
  // Inspect the raw path before URL parsing can erase dot segments.
  if (typeof rawUrl !== "string") return null;
  const match = /^app:\/\/local\/([^?#]*)(?:[?#].*)?$/.exec(rawUrl);
  return match?.[1] || null;
}

export function resolveRequest(rawUrl, options = {}) {
  const relative = parseAppUrl(rawUrl);
  if (!relative) return { status: 404 };
  const candidate = resolveAppPath(options.rootDir, relative);
  if (!candidate) return { status: 403 };
  const target = resolveAppPathReal(options.rootDir, relative, options);
  if (!target) {
    try {
      const realpath = options.realpathSync ?? fs.realpathSync;
      const root = realpath(path.resolve(options.rootDir));
      const actual = realpath(candidate);
      if (actual !== root && !actual.startsWith(root + path.sep)) return { status: 403 };
    } catch { /* Missing file. */ }
    return { status: 404 };
  }
  return { status: 200, filePath: target, mime: mimeFor(target) };
}
export function appUrl(file) {
  return `app://local/${decodeURIComponent(file).split("/").map(encodeURIComponent).join("/")}`;
}
