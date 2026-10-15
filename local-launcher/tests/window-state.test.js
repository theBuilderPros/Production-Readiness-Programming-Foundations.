import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOpen, recordWindow, forgetWindow } from "../extension/lib/window-state.js";

test("resolveOpen creates when no window is stored", () => {
  const result = resolveOpen({ state: {}, appId: "sip", liveWindowIds: [] });
  assert.equal(result.action, "create");
  assert.deepEqual(result.state, {});
});

test("resolveOpen focuses a live stored window", () => {
  const result = resolveOpen({ state: { sip: 42 }, appId: "sip", liveWindowIds: [7, 42] });
  assert.deepEqual(result, { action: "focus", windowId: 42, state: { sip: 42 } });
});

test("resolveOpen creates and prunes when the stored window is gone", () => {
  const result = resolveOpen({ state: { sip: 42 }, appId: "sip", liveWindowIds: [7] });
  assert.equal(result.action, "create");
  assert.deepEqual(result.state, {});
});

test("recordWindow stores an id without mutating the input", () => {
  const before = { sip: 1 };
  const after = recordWindow(before, "other", 2);
  assert.deepEqual(after, { sip: 1, other: 2 });
  assert.deepEqual(before, { sip: 1 });
});

test("forgetWindow removes an id without mutating the input", () => {
  const before = { sip: 1, other: 2 };
  const after = forgetWindow(before, "sip");
  assert.deepEqual(after, { other: 2 });
  assert.deepEqual(before, { sip: 1, other: 2 });
});
