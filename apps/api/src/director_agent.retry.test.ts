import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./director_agent.ts", import.meta.url), "utf8");

test("Gemini Director retries transient capacity and transport failures", () => {
  assert.match(source, /isTransientGeminiFailure/);
  assert.match(source, /429|RESOURCE_EXHAUSTED/);
  assert.match(source, /503|UNAVAILABLE/);
  assert.match(source, /high demand/i);
  assert.match(source, /Headers Timeout|HeadersTimeout|fetch failed/i);
  assert.match(source, /setTimeout/);
});

test("Gemini Director falls back to stable 2.5 Flash after primary capacity failures", () => {
  assert.match(source, /gemini-2\.5-flash/);
  assert.match(source, /modelCandidates/);
  assert.match(source, /for \(const candidateModel of modelCandidates\)/);
});

test("Gemini Director reports which model actually produced the plan", () => {
  assert.match(source, /successfulModel/);
  assert.match(source, /agentModel:\s*successfulModel/);
});
