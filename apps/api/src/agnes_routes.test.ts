import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("./server.ts", import.meta.url), "utf8");

test("active generation routes use Agnes and expose no legacy Modal/LTX callback endpoint", () => {
  assert.match(serverSource, /\/api\/generate\/image-to-video/);
  assert.match(serverSource, /\/api\/generate\/text-to-video/);
  assert.doesNotMatch(serverSource, /\/api\/modal\/webhook/);
  assert.doesNotMatch(serverSource, /\/api\/openrouter\/webhook/);
});
