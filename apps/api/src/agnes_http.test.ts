import test from "node:test";
import assert from "node:assert/strict";

import {
  createAgnesImage,
  createAgnesReferenceVideo,
  createAgnesStandardVideo,
  getAgnesResultOnce,
} from "./agnes_http.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("image generation uses Agnes Image 2.5 Flash and preserves the requested ratio", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, requestInit) => {
    url = String(input);
    init = requestInit;
    return jsonResponse({ data: [{ url: "https://cdn.example.com/frame.png" }] });
  };

  const imageUrl = await createAgnesImage(
    { prompt: "cinematic portrait", ratio: "16:9", referenceImages: ["https://cdn.example.com/ref.png"] },
    "secret",
    fetchImpl,
  );

  assert.equal(url, "https://apihub.agnes-ai.com/v1/images/generations");
  assert.equal(imageUrl, "https://cdn.example.com/frame.png");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    model: "agnes-image-2.5-flash",
    prompt: "cinematic portrait",
    size: "2K",
    ratio: "16:9",
    extra_body: {
      image: ["https://cdn.example.com/ref.png"],
      response_format: "url",
    },
  });
});

test("ordinary video generation uses free Agnes Video V2.0", async () => {
  let init: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, requestInit) => {
    init = requestInit;
    return jsonResponse({ video_id: "video-standard", task_id: "task-standard" });
  };

  const ids = await createAgnesStandardVideo(
    { prompt: "night drive", duration: 5, aspectRatio: "16:9", imageUrl: "https://cdn.example.com/start.png" },
    "secret",
    fetchImpl,
  );

  assert.equal(ids.model, "agnes-video-v2.0");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    model: "agnes-video-v2.0",
    prompt: "night drive",
    image: "https://cdn.example.com/start.png",
    width: 1152,
    height: 768,
    num_frames: 121,
    frame_rate: 24,
  });
});

test("performance and LipDub generation use free Agnes Flash image and audio references", async () => {
  let init: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, requestInit) => {
    init = requestInit;
    return jsonResponse({ video_id: "video-reference", task_id: "task-reference" });
  };

  const ids = await createAgnesReferenceVideo(
    {
      prompt: "artist performs to <Audio 1> using <Picture 1>",
      duration: 3,
      aspectRatio: "9:16",
      imageUrls: ["https://cdn.example.com/artist.png"],
      audioUrls: ["https://cdn.example.com/song.mp3"],
    },
    "secret",
    fetchImpl,
  );

  assert.equal(ids.model, "agnes-video-2.5-flash");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    model: "agnes-video-2.5-flash",
    prompt: "artist performs to <Audio 1> using <Picture 1>",
    mode: "reference",
    seconds: "4",
    size: "720P",
    aspect_ratio: "9:16",
    images: ["https://cdn.example.com/artist.png"],
    audios: ["https://cdn.example.com/song.mp3"],
  });
});

test("task polling keeps waiting states and returns completed HTTPS output", async () => {
  const waiting = await getAgnesResultOnce(
    { videoId: "video-1", taskId: "task-1", model: "agnes-video-v2.0" },
    "secret",
    async () => jsonResponse({ status: "in_progress", progress: 44 }),
  );
  assert.deepEqual(waiting, { kind: "waiting", status: "in_progress", progress: 44 });

  const completed = await getAgnesResultOnce(
    { videoId: "video-2", taskId: "task-2", model: "agnes-video-2.5-flash" },
    "secret",
    async () => jsonResponse({ status: "completed", metadata: { url: "https://cdn.example.com/final.mp4" } }),
  );
  assert.deepEqual(completed, { kind: "completed", url: "https://cdn.example.com/final.mp4" });
});

test("video status rate limits stay in progress and request a one-minute backoff", async () => {
  const limited = await getAgnesResultOnce(
    { videoId: "video-limited", taskId: "task-limited", model: "agnes-video-v2.0" },
    "secret",
    async () => jsonResponse({ detail: "video status query rate limit exceeded" }, 429),
  );

  assert.deepEqual(limited, {
    kind: "waiting",
    status: "rate_limited",
    progress: 0,
    retryAfterMs: 60_000,
  });
});
