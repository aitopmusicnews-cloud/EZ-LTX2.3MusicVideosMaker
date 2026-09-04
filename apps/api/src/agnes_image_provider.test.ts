import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agnesAI.ts", import.meta.url), "utf8");

test("Agnes Image 2.1 requests are forwarded as an explicit model override", () => {
  assert.match(source, /req\.model\s*===\s*["']agnes-image-2\.1-flash["']/);
  assert.match(source, /model:\s*requestedModel/);
});
