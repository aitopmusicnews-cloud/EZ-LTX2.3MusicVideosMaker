import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../scripts/left-rail-tools.patch.mjs", import.meta.url), "utf8");

test("Tools rail exposes the persistent Script-Locked image provider choice", () => {
  assert.match(source, /Image provider/i);
  assert.match(source, /Current image route/i);
  assert.match(source, /Agnes Text-to-Image/i);
  assert.match(source, /mvs-scriptlocked-image-provider-v1/);
  assert.match(source, /agnes-image-2\.1-flash/);
});
