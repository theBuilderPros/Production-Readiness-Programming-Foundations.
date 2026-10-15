import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { mimeFor, parseAppUrl, resolveRequest } from "../src/protocol.js";

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "proto-"));
fs.writeFileSync(path.join(rootDir, "sip.html"), "<html></html>");
fs.mkdirSync(path.join(rootDir, "assets"));
fs.writeFileSync(path.join(rootDir, "assets", "chime.mp3"), Buffer.from([1, 2, 3]));
fs.writeFileSync(path.join(rootDir, "secret.txt"), "nope");

test("mimeFor maps common extensions", () => {
  assert.equal(mimeFor("a.html"), "text/html");
  assert.equal(mimeFor("a.MP3"), "audio/mpeg");
  assert.equal(mimeFor("a.unknown"), "application/octet-stream");
});

test("parseAppUrl accepts only app://local with a path", () => {
  assert.equal(parseAppUrl("app://local/sip.html"), "sip.html");
  assert.equal(parseAppUrl("app://local/nested/app.html"), "nested/app.html");
  assert.equal(parseAppUrl("app://evil/sip.html"), null);
  assert.equal(parseAppUrl("app://local/"), null);
  assert.equal(parseAppUrl("https://127.0.0.1:8765/sip.html"), null);
  assert.equal(parseAppUrl("file:///C:/x.html"), null);
});

test("resolveRequest serves allowed files with correct mime", () => {
  const r = resolveRequest("app://local/sip.html", { rootDir });
  assert.equal(r.status, 200);
  assert.equal(r.mime, "text/html");
  assert.ok(r.filePath.endsWith("sip.html"));
  const audio = resolveRequest("app://local/assets/chime.mp3", { rootDir });
  assert.equal(audio.mime, "audio/mpeg");
});

test("resolveRequest rejects traversal and non-local hosts", () => {
  assert.equal(resolveRequest("app://local/%2e%2e%2fsecret.txt", { rootDir }).status, 403);
  assert.equal(resolveRequest("app://local/..%2fsecret.txt", { rootDir }).status, 403);
  assert.equal(resolveRequest("app://local/../secret.txt", { rootDir }).status, 403);
  assert.equal(resolveRequest("app://evil/sip.html", { rootDir }).status, 404);
});

test("resolveRequest 404s missing files", () => {
  assert.equal(resolveRequest("app://local/missing.html", { rootDir }).status, 404);
});
