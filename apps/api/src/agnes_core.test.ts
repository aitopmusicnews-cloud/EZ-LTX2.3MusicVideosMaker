import test from "node:test";
import assert from "node:assert/strict";

import {
  AGNES_IMAGE_MODEL,
  AGNES_REFERENCE_VIDEO_MODEL,
  AGNES_STANDARD_VIDEO_MODEL,
  frameCountForDuration,
  parseAgnesCreateIds,
  preferredAgnesResultUrl,
  ratioFromLegacyValue,
} from "./agnes_core.ts";

test("only the approved free Agnes models are selected", () => {
  assert.equal(AGNES_IMAGE_MODEL, "agnes-image-2.5-flash");
  assert.equal(AGNES_STANDARD_VIDEO_MODEL, "agnes-video-v2.0");
  assert.equal(AGNES_REFERENCE_VIDEO_MODEL, "agnes-video-2.5-flash");
});

test("frame count covers the requested duration and follows Agnes 8n+1 rule", () => {
  assert.equal(frameCountForDuration(5), 121);
  assert.equal(frameCountForDuration(1), 25);
  assert.throws(() => frameCountForDuration(0), /positive/i);
});

test("legacy UI dimensions are normalized to Agnes aspect ratios", () => {
  assert.equal(ratioFromLegacyValue("1920:1080"), "16:9");
  assert.equal(ratioFromLegacyValue("1080:1920"), "9:16");
  assert.equal(ratioFromLegacyValue("1024:1024"), "1:1");
  assert.equal(ratioFromLegacyValue("3:2"), "3:2");
  assert.equal(ratioFromLegacyValue(undefined), "16:9");
});

test("Agnes task identifiers and model-aware status URL are preserved", () => {
  assert.deepEqual(
    parseAgnesCreateIds({ video_id: "video-1", task_id: "task-1" }, AGNES_REFERENCE_VIDEO_MODEL),
    { videoId: "video-1", taskId: "task-1", model: AGNES_REFERENCE_VIDEO_MODEL },
  );
  const url = new URL(preferredAgnesResultUrl("video id/1", AGNES_REFERENCE_VIDEO_MODEL));
  assert.equal(url.searchParams.get("video_id"), "video id/1");
  assert.equal(url.searchParams.get("model_name"), AGNES_REFERENCE_VIDEO_MODEL);
});
