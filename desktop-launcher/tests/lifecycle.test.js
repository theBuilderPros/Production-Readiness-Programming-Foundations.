import { test } from "node:test";
import assert from "node:assert/strict";
import { createLifecycle } from "../src/lifecycle.js";

test("hides the launcher on close while not quitting", () => {
  const lc = createLifecycle();
  assert.equal(lc.isQuitting(), false);
  assert.equal(lc.shouldHideOnClose("launcher"), true);
  assert.equal(lc.shouldHideOnClose("app"), false);
});

test("beginQuit stops hiding windows", () => {
  const lc = createLifecycle();
  lc.beginQuit();
  assert.equal(lc.isQuitting(), true);
  assert.equal(lc.shouldHideOnClose("launcher"), false);
});
