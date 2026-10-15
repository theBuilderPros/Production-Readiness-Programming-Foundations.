import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const here = new URL("../", import.meta.url);
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("manifest.json is valid MV3 with the expected keys", () => {
  const manifest = JSON.parse(readFileSync(new URL("extension/manifest.json", here), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, "launcher.html");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.background, { service_worker: "background.js", type: "module" });
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1:8765/*"));
});

test("icon files exist and are PNGs", () => {
  for (const size of [16, 48, 128]) {
    const path = new URL(`extension/icons/icon${size}.png`, here);
    assert.ok(existsSync(path), `missing icon${size}.png`);
    const head = readFileSync(path).subarray(0, 8);
    assert.ok(head.equals(PNG_SIG), `icon${size}.png is not a PNG`);
  }
});
