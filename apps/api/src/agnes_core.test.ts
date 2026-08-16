import test from "node:test";
import assert from "node:assert/strict";

import {
  AGNES_FRAME_RATE,
  AGNES_MAX_FRAMES,
  AGNES_MODEL,
  frameCountForDuration,
  isAgnesWaitStatus,
  parseAgnesCreateIds,
  preferredAgnesResultUrl,
  requireTimelineDuration,
  splitTimelineDuration,
  validCompletedMetadataUrl,
} from "./agnes_core.ts";



test("timeline duration is mandatory and must be positive", () => {
  assert.equal(requireTimelineDuration(7.25), 7.25);
  assert.throws(() => requireTimelineDuration(undefined), /duration/i);
  assert.throws(() => requireTimelineDuration(0), /positive/i);
  assert.throws(() => requireTimelineDuration(Number.NaN), /positive/i);
});

test("frameCountForDuration chooses the smallest 8n+1 frame count that covers the slot", () => {
  assert.equal(frameCountForDuration(5), 121);
  assert.equal(frameCountForDuration(6), 145);
  assert.equal(frameCountForDuration(0.5), 17);
  for (const duration of [0.5, 1, 4.2, 5, 6, 12.75, AGNES_MAX_FRAMES / AGNES_FRAME_RATE]) {
    const frames = frameCountForDuration(duration);
    assert.equal((frames - 1) % 8, 0);
    assert.ok(frames <= AGNES_MAX_FRAMES);
    assert.ok(frames / AGNES_FRAME_RATE >= duration);
    if (frames > 1) assert.ok((frames - 8) / AGNES_FRAME_RATE < duration);
  }
});

test("splitTimelineDuration preserves the requested duration and keeps every Agnes segment valid", () => {
  const requested = 40.25;
  const segments = splitTimelineDuration(requested);
  assert.ok(segments.length > 1);
  const total = segments.reduce((sum, segment) => sum + segment.targetDuration, 0);
  assert.ok(Math.abs(total - requested) < 1e-9);
  for (const segment of segments) {
    assert.equal((segment.numFrames - 1) % 8, 0);
    assert.ok(segment.numFrames <= AGNES_MAX_FRAMES);
    assert.ok(segment.numFrames / AGNES_FRAME_RATE >= segment.targetDuration);
  }
});

test("Agnes wait-state support is explicit", () => {
  for (const status of ["pending", "queued", "in_progress"]) assert.equal(isAgnesWaitStatus(status), true);
  for (const status of ["completed", "failed", "processing", "", "unknown"]) assert.equal(isAgnesWaitStatus(status), false);
});

test("create response keeps video_id and task_id separate", () => {
  assert.deepEqual(parseAgnesCreateIds({ video_id: "video-123", task_id: "task-456" }), {
    videoId: "video-123",
    taskId: "task-456",
  });
  assert.deepEqual(parseAgnesCreateIds({ video_id: "same", task_id: "same" }), {
    videoId: "same",
    taskId: "same",
  });
  assert.throws(() => parseAgnesCreateIds({ task_id: "task-only" }), /video_id/);
});

test("preferred result URL includes video_id and the Agnes model name", () => {
  const url = new URL(preferredAgnesResultUrl("video id/123"));
  assert.equal(url.origin + url.pathname, "https://apihub.agnes-ai.com/agnesapi");
  assert.equal(url.searchParams.get("video_id"), "video id/123");
  assert.equal(url.searchParams.get("model_name"), AGNES_MODEL);
});

test("completed result accepts only HTTPS metadata.url", () => {
  assert.equal(validCompletedMetadataUrl({ metadata: { url: "https://cdn.example.com/video.mp4" } }), "https://cdn.example.com/video.mp4");
  assert.equal(validCompletedMetadataUrl({ metadata: { url: "http://cdn.example.com/video.mp4" } }), null);
  assert.equal(validCompletedMetadataUrl({ result: { url: "https://cdn.example.com/video.mp4" } }), null);
  assert.equal(validCompletedMetadataUrl({ metadata: { video_url: "https://cdn.example.com/video.mp4" } }), null);
});
