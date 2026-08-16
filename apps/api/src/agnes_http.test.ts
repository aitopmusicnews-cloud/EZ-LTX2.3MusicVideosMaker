import test from "node:test";
import assert from "node:assert/strict";

import { createAgnesVideo, getAgnesResultOnce } from "./agnes_http.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}


test("create request sends the Agnes V2.0 text-to-video payload without an image field", async () => {
  let requestUrl = "";
  let init: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, requestInit) => {
    requestUrl = String(input);
    init = requestInit;
    return jsonResponse({ video_id: "video-text", task_id: "task-text" });
  };
  const ids = await createAgnesVideo(
    { prompt: "cinematic skyline", width: 1152, height: 768, numFrames: 145 },
    "secret",
    fetchImpl,
  );
  assert.deepEqual(ids, { videoId: "video-text", taskId: "task-text" });
  assert.equal(requestUrl, "https://apihub.agnes-ai.com/v1/videos");
  const body = JSON.parse(String(init?.body));
  assert.deepEqual(body, {
    model: "agnes-video-v2.0",
    prompt: "cinematic skyline",
    width: 1152,
    height: 768,
    num_frames: 145,
    frame_rate: 24,
  });
});

test("create request sends the existing HTTPS reference image for Agnes image-to-video", async () => {
  let init: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, requestInit) => {
    init = requestInit;
    return jsonResponse({ video_id: "video-image" });
  };
  await createAgnesVideo(
    {
      prompt: "artist performance",
      imageUrl: "https://private.example.com/presigned.jpg",
      width: 768,
      height: 1152,
      numFrames: 97,
    },
    "secret",
    fetchImpl,
  );
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, "agnes-video-v2.0");
  assert.equal(body.image, "https://private.example.com/presigned.jpg");
  assert.equal(body.width, 768);
  assert.equal(body.height, 1152);
  assert.equal(body.num_frames, 97);
  assert.equal(body.frame_rate, 24);
});

test("pending, queued, and in_progress remain non-terminal and never call legacy fallback", async () => {
  for (const status of ["pending", "queued", "in_progress"]) {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({ status });
    };
    const result = await getAgnesResultOnce(
      { videoId: "video-1", taskId: "task-1" },
      "secret",
      fetchImpl,
    );
    assert.deepEqual(result, { kind: "waiting", status });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /model_name=agnes-video-v2\.0/);
  }
});

test("completed preferred result returns HTTPS metadata.url without fallback", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return jsonResponse({ status: "completed", metadata: { url: "https://cdn.example.com/final.mp4" } });
  };
  const result = await getAgnesResultOnce({ videoId: "video-2", taskId: "task-2" }, "secret", fetchImpl);
  assert.deepEqual(result, { kind: "completed", url: "https://cdn.example.com/final.mp4" });
  assert.equal(calls.length, 1);
});

test("completed result uses task_id fallback exactly once when preferred metadata.url is missing", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) return jsonResponse({ status: "completed", metadata: { id: "no-url" } });
    return jsonResponse({ status: "completed", metadata: { url: "https://cdn.example.com/legacy.mp4" } });
  };
  const result = await getAgnesResultOnce({ videoId: "video-3", taskId: "task-3" }, "secret", fetchImpl);
  assert.deepEqual(result, { kind: "completed", url: "https://cdn.example.com/legacy.mp4" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], "https://apihub.agnes-ai.com/v1/videos/task-3");
});

test("failed result returns a clear provider error", async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({ status: "failed" });
  await assert.rejects(
    getAgnesResultOnce({ videoId: "video-4", taskId: null }, "secret", fetchImpl),
    /Agnes video generation failed/,
  );
});

test("completed result rejects undocumented URLs and fails if task_id fallback cannot provide metadata.url", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes("/agnesapi?")) {
      return jsonResponse({ status: "completed", result: { url: "https://cdn.example.com/ignored.mp4" } });
    }
    return jsonResponse({ status: "completed", metadata: { video_url: "https://cdn.example.com/ignored2.mp4" } });
  };
  await assert.rejects(
    getAgnesResultOnce({ videoId: "video-5", taskId: "task-5" }, "secret", fetchImpl),
    /valid HTTPS metadata\.url/,
  );
});
