import {
  AGNES_IMAGE_MODEL,
  AGNES_IMAGE_URL,
  AGNES_REFERENCE_VIDEO_MODEL,
  AGNES_STANDARD_VIDEO_MODEL,
  AGNES_VIDEO_URL,
  agnesDimensions,
  agnesFlashSeconds,
  completedAgnesUrl,
  frameCountForDuration,
  parseAgnesCreateIds,
  preferredAgnesResultUrl,
  ratioFromLegacyValue,
  type AgnesCreateIds,
} from "./agnes_core.js";

const REQUEST_TIMEOUT_MS = 120_000;
type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response, context: string): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Agnes returned a malformed ${context} response.`);
  }
  if (!isRecord(payload)) throw new Error(`Agnes returned a malformed ${context} response.`);
  if (!response.ok) {
    const detail = typeof payload.detail === "string"
      ? payload.detail
      : isRecord(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : `status ${response.status}`;
    throw new Error(`Agnes ${context} request failed: ${detail}`);
  }
  return payload;
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function createAgnesImage(
  input: { prompt: string; ratio: string; referenceImages?: string[] },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl(AGNES_IMAGE_URL, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: AGNES_IMAGE_MODEL,
      prompt: input.prompt,
      size: "2K",
      ratio: ratioFromLegacyValue(input.ratio),
      extra_body: {
        ...(input.referenceImages?.length ? { image: input.referenceImages.slice(0, 5) } : {}),
        response_format: "url",
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await readJson(response, "image-generation");
  const data = Array.isArray(payload.data) ? payload.data : [];
  const first = isRecord(data[0]) ? data[0] : null;
  const rawUrl = first && typeof first.url === "string" ? first.url : "";
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:") return url.toString();
  } catch {
    // Report one provider-contract error below.
  }
  throw new Error("Agnes image generation returned no valid HTTPS image URL.");
}

export async function createAgnesStandardVideo(
  input: { prompt: string; duration: number; aspectRatio: string; imageUrl?: string },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AgnesCreateIds> {
  const ratio = ratioFromLegacyValue(input.aspectRatio);
  const dimensions = agnesDimensions(ratio);
  const response = await fetchImpl(AGNES_VIDEO_URL, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: AGNES_STANDARD_VIDEO_MODEL,
      prompt: input.prompt,
      ...(input.imageUrl ? { image: input.imageUrl } : {}),
      ...dimensions,
      num_frames: frameCountForDuration(input.duration),
      frame_rate: 24,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return parseAgnesCreateIds(await readJson(response, "create-video"), AGNES_STANDARD_VIDEO_MODEL);
}

export async function createAgnesReferenceVideo(
  input: {
    prompt: string;
    duration: number;
    aspectRatio: string;
    imageUrls?: string[];
    audioUrls?: string[];
  },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AgnesCreateIds> {
  const images = input.imageUrls?.filter(Boolean).slice(0, 5) ?? [];
  const audios = input.audioUrls?.filter(Boolean).slice(0, 3) ?? [];
  if (!images.length && !audios.length) {
    throw new Error("Agnes reference video generation requires an image or audio reference.");
  }
  const response = await fetchImpl(AGNES_VIDEO_URL, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: AGNES_REFERENCE_VIDEO_MODEL,
      prompt: input.prompt,
      mode: "reference",
      seconds: agnesFlashSeconds(input.duration),
      size: "720P",
      aspect_ratio: ratioFromLegacyValue(input.aspectRatio),
      ...(images.length ? { images } : {}),
      ...(audios.length ? { audios } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return parseAgnesCreateIds(await readJson(response, "create-reference-video"), AGNES_REFERENCE_VIDEO_MODEL);
}

export type AgnesResult =
  | { kind: "waiting"; status: "pending" | "queued" | "in_progress"; progress: number }
  | { kind: "completed"; url: string };

export async function getAgnesResultOnce(
  ids: AgnesCreateIds,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AgnesResult> {
  const response = await fetchImpl(preferredAgnesResultUrl(ids.videoId, ids.model), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  const payload = await readJson(response, "video-status");
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
  if (status === "pending" || status === "queued" || status === "in_progress") {
    const progress = typeof payload.progress === "number" ? payload.progress : 0;
    return { kind: "waiting", status, progress };
  }
  if (status === "failed") {
    const error = isRecord(payload.error) && typeof payload.error.message === "string"
      ? payload.error.message
      : "Agnes video generation failed before producing a video.";
    throw new Error(error);
  }
  if (status !== "completed") {
    throw new Error(`Agnes returned an unexpected video status: ${status || "missing"}.`);
  }
  const url = completedAgnesUrl(payload);
  if (url) return { kind: "completed", url };

  if (ids.taskId) {
    const legacyResponse = await fetchImpl(`${AGNES_VIDEO_URL}/${encodeURIComponent(ids.taskId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    const legacyUrl = completedAgnesUrl(await readJson(legacyResponse, "legacy-video-result"));
    if (legacyUrl) return { kind: "completed", url: legacyUrl };
  }
  throw new Error("Agnes completed without returning a valid HTTPS metadata.url.");
}
