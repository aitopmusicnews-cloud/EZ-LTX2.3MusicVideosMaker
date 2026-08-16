import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Fastify exposes the render queue routes used by the existing web client", async () => {
  const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(source, /app\.post\("\/api\/render"/);
  assert.match(source, /app\.get\("\/api\/render\/jobs\/:id"/);
  assert.match(source, /renderId:\s*job\.id/);
});
