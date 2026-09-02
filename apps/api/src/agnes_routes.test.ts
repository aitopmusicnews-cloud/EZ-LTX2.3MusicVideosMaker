import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("./server.ts", import.meta.url), "utf8");
const configSource = await readFile(new URL("./config.ts", import.meta.url), "utf8");
const agnesAiSource = await readFile(new URL("./agnesAI.ts", import.meta.url), "utf8");
const schedulerSource = await readFile(new URL("../../web/src/lib/scheduler.ts", import.meta.url), "utf8");
const warmupSource = await readFile(new URL("../scripts/start-with-warmup.mjs", import.meta.url), "utf8");

test("all existing generation routes remain available", () => {
  for (const route of ["text-to-image", "text-to-video", "image-to-video", "performance", "lip-sync"]) {
    assert.match(serverSource, new RegExp(`/api/generate/${route}`));
  }
});

test("active server, config, and startup contain no Modal runtime integration", () => {
  assert.doesNotMatch(serverSource, /modalAI|\/api\/modal\/webhook|MODAL_/);
  assert.doesNotMatch(configSource, /MODAL_/);
  assert.doesNotMatch(warmupSource, /MODAL_/);
  assert.match(configSource, /AGNES_API_KEY/);
});

test("Agnes status polling is cached server-side and video creation is serialized", () => {
  assert.match(agnesAiSource, /AGNES_STATUS_POLL_INTERVAL_MS/);
  assert.match(agnesAiSource, /nextPollAt/);
  assert.match(schedulerSource, /MAX_CONCURRENT\s*=\s*1/);
});
