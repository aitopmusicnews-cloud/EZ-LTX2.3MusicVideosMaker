import test from "node:test";
import assert from "node:assert/strict";
import { buildDirectorChatRequest } from "./directorChatClient.js";

test("asset chat payload includes the locked target", () => {
  const payload = buildDirectorChatRequest({
    message: "make it warmer",
    plan: { shots: [] },
    references: [],
    sceneImages: {},
    shotImages: {},
    history: [],
    target: { type: "shot_image", clipId: "clip-a" },
  });
  assert.deepEqual(payload.target, { type: "shot_image", clipId: "clip-a" });
});

test("global chat payload omits target when none is supplied", () => {
  const payload = buildDirectorChatRequest({
    message: "make clip 1 warmer",
    plan: { shots: [] },
    references: [],
    sceneImages: {},
    shotImages: {},
    history: [],
  });
  assert.equal("target" in payload, false);
});
