import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const here = new URL("../", import.meta.url);

test("apps/sip.html is a byte-for-byte copy of the source sip.html", () => {
  const shipped = readFileSync(new URL("apps/sip.html", here));
  const source = readFileSync(new URL("../sip.html", here));
  assert.ok(shipped.equals(source), "apps/sip.html must match the original");
});

test("apps/apps.json parses and declares an apps array", () => {
  const raw = readFileSync(new URL("apps/apps.json", here), "utf8");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.apps));
  assert.ok(data.apps.length >= 1);
});
