import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GEMINI_DIRECTOR_FALLBACK_MODEL,
  isTransientGeminiFailure,
  runGeminiDirectorWithFallback,
} from "./gemini_director_retry.js";

test("Gemini Director recognizes provider capacity and transport failures as transient", () => {
  assert.equal(isTransientGeminiFailure(Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 })), true);
  assert.equal(isTransientGeminiFailure(Object.assign(new Error("UNAVAILABLE: high demand"), { status: 503 })), true);
  assert.equal(isTransientGeminiFailure(new Error("fetch failed: Headers Timeout Error")), true);
  assert.equal(isTransientGeminiFailure(new Error("invalid API key")), false);
});

test("Gemini Director retries the primary model before falling back", async () => {
  const calls: string[] = [];
  let primaryAttempts = 0;
  const result = await runGeminiDirectorWithFallback("gemini-primary", async (model) => {
    calls.push(model);
    if (model === "gemini-primary") {
      primaryAttempts += 1;
      if (primaryAttempts === 1) throw new Error("This model is currently experiencing high demand");
      return "primary recovered";
    }
    return "fallback";
  }, { retriesPerModel: 2, baseDelayMs: 0 });

  assert.equal(result.value, "primary recovered");
  assert.equal(result.model, "gemini-primary");
  assert.deepEqual(calls, ["gemini-primary", "gemini-primary"]);
});

test("Gemini Director uses supported 3.7 Flash when the primary remains capacity-limited", async () => {
  assert.equal(GEMINI_DIRECTOR_FALLBACK_MODEL, "gemini-3.7-flash");
  assert.notEqual(GEMINI_DIRECTOR_FALLBACK_MODEL, "gemini-2.5-flash");

  const calls: string[] = [];
  const result = await runGeminiDirectorWithFallback("gemini-primary", async (model) => {
    calls.push(model);
    if (model === "gemini-primary") throw Object.assign(new Error("UNAVAILABLE: high demand"), { status: 503 });
    return "fallback plan";
  }, { retriesPerModel: 2, baseDelayMs: 0 });

  assert.equal(result.value, "fallback plan");
  assert.equal(result.model, "gemini-3.7-flash");
  assert.deepEqual(calls, ["gemini-primary", "gemini-primary", "gemini-3.7-flash"]);
});

test("non-transient Gemini errors do not fan out to fallback models", async () => {
  const calls: string[] = [];
  await assert.rejects(
    runGeminiDirectorWithFallback("gemini-primary", async (model) => {
      calls.push(model);
      throw new Error("Gemini Director failed: invalid API key");
    }, { retriesPerModel: 2, baseDelayMs: 0 }),
    /invalid API key/,
  );
  assert.deepEqual(calls, ["gemini-primary"]);
});

test("API build wires resilient Gemini results into the Director plan and reports the successful model", async () => {
  const buildSource = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(buildSource, /runGeminiDirectorWithFallback/);
  assert.match(buildSource, /successfulModel/);
  assert.match(buildSource, /agentModel: successfulModel/);
});
