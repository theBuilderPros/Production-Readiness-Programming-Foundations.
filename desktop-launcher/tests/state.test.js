import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  sanitizeState, readState, writeState, isVisibleOnDisplays, resolveBounds, centeredBounds,
} from "../src/state.js";

test("sanitizeState returns empty defaults for garbage", () => {
  assert.deepEqual(sanitizeState(null), { apps: {}, launcher: {} });
  assert.deepEqual(sanitizeState("nope"), { apps: {}, launcher: {} });
  assert.deepEqual(sanitizeState({ apps: { sip: { bounds: { x: "a" } } } }), { apps: {}, launcher: {} });
});

test("sanitizeState keeps valid entries only", () => {
  const state = sanitizeState({
    apps: { sip: { bounds: { x: 1, y: 2, width: 380, height: 560 }, alwaysOnTop: true }, bad: { alwaysOnTop: "yes" } },
    launcher: { bounds: { x: 0, y: 0, width: 420, height: 320 } },
  });
  assert.deepEqual(state.apps.sip, { bounds: { x: 1, y: 2, width: 380, height: 560 }, alwaysOnTop: true });
  assert.equal(state.apps.bad, undefined);
  assert.deepEqual(state.launcher.bounds, { x: 0, y: 0, width: 420, height: 320 });
});

test("readState falls back to defaults on corrupt file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-"));
  const file = path.join(dir, "window-state.json");
  fs.writeFileSync(file, "{ broken");
  assert.deepEqual(readState(file), { apps: {}, launcher: {} });
  assert.deepEqual(readState(path.join(dir, "missing.json")), { apps: {}, launcher: {} });
});

test("writeState is atomic and round-trips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-"));
  const file = path.join(dir, "window-state.json");
  const state = { apps: { sip: { alwaysOnTop: false } }, launcher: {} };
  writeState(file, state);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), state);
  assert.equal(fs.existsSync(file + ".tmp"), false);
});

test("isVisibleOnDisplays detects on/off-screen rectangles", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.equal(isVisibleOnDisplays({ x: 100, y: 100, width: 380, height: 560 }, displays), true);
  assert.equal(isVisibleOnDisplays({ x: 5000, y: 5000, width: 380, height: 560 }, displays), false);
  assert.equal(isVisibleOnDisplays(null, displays), false);
});

test("resolveBounds falls back to defaults when off-screen", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const saved = { x: 4000, y: 4000, width: 380, height: 560 };
  const defaults = { x: 100, y: 100, width: 380, height: 560 };
  assert.deepEqual(resolveBounds(saved, defaults, displays), defaults);
  assert.deepEqual(resolveBounds({ x: 10, y: 10, width: 380, height: 560 }, defaults, displays), { x: 10, y: 10, width: 380, height: 560 });
});

test("centeredBounds centers within a display work area", () => {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  assert.deepEqual(centeredBounds(380, 560, display), {
    x: Math.round((1920 - 380) / 2),
    y: Math.round((1080 - 560) / 2),
    width: 380,
    height: 560,
  });
});
