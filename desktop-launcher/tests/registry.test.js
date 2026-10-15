import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  normalizeApp, parseRegistry, loadRegistry, resolveAppPath, resolveAppPathReal,
  DEFAULT_WIDTH, DEFAULT_HEIGHT, MIN_WIDTH, MAX_WIDTH, MIN_HEIGHT, MAX_HEIGHT,
} from "../src/registry.js";

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "apps-"));
fs.writeFileSync(path.join(rootDir, "sip.html"), "<html></html>");

test("normalizeApp fills defaults", () => {
  const app = normalizeApp({ id: "a", name: "A", file: "a.html" });
  assert.deepEqual(app, {
    id: "a", name: "A", file: "a.html", mode: "window",
    width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, description: "",
  });
});

test("normalizeApp keeps explicit values and clamps dimensions", () => {
  const app = normalizeApp({ id: "sip", name: "Sip", file: "sip.html", width: 380, height: 560, description: "Water reminder" });
  assert.equal(app.width, 380);
  assert.equal(app.height, 560);
  assert.equal(app.description, "Water reminder");
  const big = normalizeApp({ id: "b", name: "B", file: "b.html", width: 99999, height: 1 });
  assert.equal(big.width, MAX_WIDTH);
  assert.equal(big.height, MIN_HEIGHT);
});

test("normalizeApp falls back to window for unknown mode and rejects bad entries", () => {
  assert.equal(normalizeApp({ id: "a", name: "A", file: "a.html", mode: "tab" }).mode, "window");
  assert.throws(() => normalizeApp({ name: "A", file: "a.html" }), /id/);
  assert.throws(() => normalizeApp({ id: "a", file: "a.html" }), /name/);
  assert.throws(() => normalizeApp({ id: "a", name: "A" }), /file/);
});

test("resolveAppPath rejects traversal, absolute, and drive paths", () => {
  assert.ok(resolveAppPath(rootDir, "sip.html"));
  assert.equal(resolveAppPath(rootDir, "../secret.html"), null);
  assert.equal(resolveAppPath(rootDir, "..%2fsecret.html"), null);
  assert.equal(resolveAppPath(rootDir, "%2e%2e%2fsecret.html"), null);
  assert.equal(resolveAppPath(rootDir, "..\\secret.html"), null);
  assert.equal(resolveAppPath(rootDir, "C:\\Windows\\win.ini"), null);
  assert.equal(resolveAppPath(rootDir, "/etc/passwd"), null);
});

test("resolveAppPathReal requires an existing file under root", () => {
  assert.ok(resolveAppPathReal(rootDir, "sip.html", {}));
  assert.equal(resolveAppPathReal(rootDir, "missing.html", {}), null);
});

test("parseRegistry accepts the shipped apps.json entry", () => {
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "local-launcher", "apps", "apps.json"), "utf8"));
  const appsRoot = path.resolve(process.cwd(), "..", "local-launcher", "apps");
  const { apps, byId } = parseRegistry(data, { rootDir: appsRoot });
  assert.equal(apps.length, data.apps.length);
  assert.equal(apps[0].id, "sip");
  assert.equal(apps[0].width, 380);
  assert.ok(byId.get("sip").endsWith("sip.html"));
});

test("parseRegistry rejects duplicates and missing files", () => {
  assert.throws(() => parseRegistry({ apps: [
    { id: "x", name: "X", file: "sip.html" },
    { id: "x", name: "X2", file: "sip.html" },
  ] }, { rootDir }), /Duplicate/);
  assert.throws(() => parseRegistry({ apps: [{ id: "y", name: "Y", file: "nope.html" }] }, { rootDir }), /missing|outside/);
});

test("parseRegistry rejects a payload without apps array", () => {
  assert.throws(() => parseRegistry(null, { rootDir }), /apps/);
  assert.throws(() => parseRegistry({}, { rootDir }), /apps/);
});

test("loadRegistry reports malformed JSON and missing files", () => {
  const bad = path.join(rootDir, "bad.json");
  fs.writeFileSync(bad, "{ not json");
  assert.throws(() => loadRegistry(bad, {}), /valid JSON/);
  assert.throws(() => loadRegistry(path.join(rootDir, "gone.json"), {}), /not found/);
});
