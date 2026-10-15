import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeApp,
  parseApps,
  DEFAULT_MODE,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
} from "../extension/lib/apps-core.js";

test("normalizeApp fills defaults for omitted optional fields", () => {
  const app = normalizeApp({ id: "a", name: "A", file: "a.html" });
  assert.deepEqual(app, {
    id: "a", name: "A", file: "a.html",
    mode: DEFAULT_MODE, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT,
    description: "",
  });
});

test("normalizeApp keeps explicit values", () => {
  const app = normalizeApp({ id: "sip", name: "Sip", file: "sip.html", mode: "window", width: 380, height: 560, description: "Water reminder" });
  assert.equal(app.width, 380);
  assert.equal(app.height, 560);
  assert.equal(app.description, "Water reminder");
});

test("normalizeApp falls back to window for an unknown mode", () => {
  const app = normalizeApp({ id: "a", name: "A", file: "a.html", mode: "tab" });
  assert.equal(app.mode, "window");
});

test("normalizeApp rejects entries without id, name, or file", () => {
  assert.throws(() => normalizeApp({ name: "A", file: "a.html" }), /id/);
  assert.throws(() => normalizeApp({ id: "a", file: "a.html" }), /name/);
  assert.throws(() => normalizeApp({ id: "a", name: "A" }), /file/);
});

test("parseApps rejects a payload without an apps array", () => {
  assert.throws(() => parseApps(null), /apps/);
  assert.throws(() => parseApps({}), /apps/);
  assert.throws(() => parseApps({ apps: "nope" }), /apps/);
});

test("parseApps normalises every entry", () => {
  const apps = parseApps({ apps: [{ id: "a", name: "A", file: "a.html" }] });
  assert.equal(apps.length, 1);
  assert.equal(apps[0].mode, DEFAULT_MODE);
});
