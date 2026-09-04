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
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;
type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class AgnesRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(context: string, detail: string, retryAfterMs = DEFAULT_RATE_LIMIT_BACKOFF_MS) {
    super(`Agnes ${context} request rate limited: ${detail}`);
    this.name = "AgnesRateLimitError";
    this.retryAfterMs = Math.max(DEFAULT_RATE_LIMIT_BACKOFF_MS, retryAfterMs);
  }
}

function retryAfterMs(response: Response): number {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return DEFAULT_RATE_LIMIT_BACKOFF_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : DEFAULT_RATE_LIMIT_BACKOFF_MS;
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
    if (response.status === 429) {
      throw new AgnesRateLimitError(context, detail, retryAfterMs(response));
    }
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
  input: { prompt: string; ratio: string; referenceImages?: string[]; model?: "agnes-image-2.1-flash" },
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl(AGNES_IMAGE_URL, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: input.model ?? AGNES_IMAGE_MODEL,
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
  | {
      kind: "waiting";
      status: "pending" | "queued" | "in_progress" | "rate_limited";
      progress: number;
      retryAfterMs?: number;
    }
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
  let payload: Record<string, unknown>;
  try {
    payload = await readJson(response, "video-status");
  } catch (error) {
    if (error instanceof AgnesRateLimitError) {
      return {
        kind: "waiting",
        status: "rate_limited",
        progress: 0,
        retryAfterMs: error.retryAfterMs,
      };
    }
    throw error;
  }
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
  throw new Error("Agnes completed without returning a valid HTTPS video URL.");
}
