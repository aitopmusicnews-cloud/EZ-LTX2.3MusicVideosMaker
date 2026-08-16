import test from "node:test";
import assert from "node:assert/strict";
import { agnesClientPollTimeoutMs } from "./agnes-polling.ts";

test("normal Agnes slots retain at least the existing 15-minute client timeout", () => {
  assert.equal(agnesClientPollTimeoutMs(6), 900_000);
  assert.equal(agnesClientPollTimeoutMs(18.375), 900_000);
});

test("long Agnes slots scale the client timeout to cover sequential provider segments", () => {
  assert.equal(agnesClientPollTimeoutMs(40.25), 1_200_000);
  assert.equal(agnesClientPollTimeoutMs(120), 2_640_000);
});

test("invalid durations fail instead of silently assuming a legacy duration", () => {
  assert.throws(() => agnesClientPollTimeoutMs(0), /positive/i);
  assert.throws(() => agnesClientPollTimeoutMs(Number.NaN), /positive/i);
});
