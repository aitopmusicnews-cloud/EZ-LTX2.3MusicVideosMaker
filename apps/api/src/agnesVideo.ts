import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ImageToVideoRequest, TextToVideoRequest } from "@mvs/shared";
import { config } from "./config.js";
import { createAgnesVideo, getAgnesResultOnce } from "./agnes_http.js";
import { requireTimelineDuration, splitTimelineDuration, type AgnesCreateIds, type AgnesDurationSegment } from "./agnes_core.js";
import { normalizeGeneratedVisual } from "./ffmpeg.js";
import { extractLastFrame } from "./frames.js";
import {
  encodeTaskId,
  readJobFromDisk,
  writeJobToDisk,
  type GenerationTask,
  type JobRecord,
} from "./generationJobs.js";
import { assertSafeHost, readCappedBody } from "./net.js";
import { providerUrl, storage } from "./storage.js";
import { stitchVideoSegments } from "./video_stitch.js";

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 360_000;
const PROVIDER_IMAGE_TTL_SECONDS = 15 * 60;
const MAX_PROVIDER_VIDEO_BYTES = 350 * 1024 * 1024;
const MAX_SAFE_REDIRECTS = 3;

type AgnesSegmentJob = AgnesDurationSegment & {
  videoId?: string;
  taskId?: string | null;
  startedAt?: number;
  lastPollAt?: number;
  outputUrl?: string;
};

type AgnesJobState = {
  kind: "agnes-video-v2.0";
  targetDuration: number;
  aspectRatio: string;
  sourceMode: "textToVideo" | "imageToVideo";
  imageSourceUrl?: string;
  currentSegment: number;
  segments: AgnesSegmentJob[];
};

type AgnesGenerationRequest = ImageToVideoRequest | TextToVideoRequest;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgnesState(value: unknown): value is AgnesJobState {
  return (
    isRecord(value) &&
    value.kind === "agnes-video-v2.0" &&
    typeof value.targetDuration === "number" &&
    typeof value.aspectRatio === "string" &&
    (value.sourceMode === "textToVideo" || value.sourceMode === "imageToVideo") &&
    typeof value.currentSegment === "number" &&
    Array.isArray(value.segments)
  );
}

function agnesApiKey(): string {
  const value = config.AGNES_API_KEY?.trim();
  if (!value) throw new Error("AGNES_API_KEY is not configured. Agnes video generation is offline.");
  return value;
}

function agnesInputDimensions(aspectRatio: string): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 768, height: 1152 };
  return { width: 1152, height: 768 };
}

function requestedAspectRatio(req: AgnesGenerationRequest): string {
  if (typeof req.aspectRatio === "string" && req.aspectRatio.trim()) return req.aspectRatio.trim();
  if ("ratio" in req && typeof req.ratio === "string" && req.ratio.trim()) return req.ratio.trim();
  return "16:9";
}

function sourceImage(req: AgnesGenerationRequest): string | undefined {
  if (!("imageUrl" in req) && !("promptImage" in req)) return undefined;
  const image = (req as ImageToVideoRequest).promptImage ?? (req as ImageToVideoRequest).imageUrl;
  return typeof image === "string" && image.trim() ? image.trim() : undefined;
}

async function agnesImageUrl(rawUrl: string): Promise<string> {
  const url = await providerUrl(rawUrl, PROVIDER_IMAGE_TTL_SECONDS);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Agnes image inputs must use HTTPS.");
  await assertSafeHost(url);
  return url;
}

async function createSegment(
  state: AgnesJobState,
  segmentIndex: number,
  prompt: string,
  imageUrl?: string,
): Promise<AgnesCreateIds> {
  const segment = state.segments[segmentIndex];
  if (!segment) throw new Error("Agnes segment index is out of range.");
  const { width, height } = agnesInputDimensions(state.aspectRatio);
  return createAgnesVideo(
    {
      prompt,
      ...(imageUrl ? { imageUrl } : {}),
      width,
      height,
      numFrames: segment.numFrames,
    },
    agnesApiKey(),
  );
}

async function fetchProviderVideo(url: string): Promise<Buffer> {
  let current = new URL(url);
  for (let redirect = 0; redirect <= MAX_SAFE_REDIRECTS; redirect += 1) {
    if (current.protocol !== "https:") throw new Error("Agnes completed video URL must use HTTPS.");
    await assertSafeHost(current.toString());
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    if (response.status >= 300 && response.status < 400) {
      if (redirect === MAX_SAFE_REDIRECTS) throw new Error("Agnes video download redirected too many times.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Agnes video download returned a redirect without a location.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Agnes completed video download failed with status ${response.status}.`);
    const bytes = await readCappedBody(response, MAX_PROVIDER_VIDEO_BYTES);
    if (bytes.byteLength === 0) throw new Error("Agnes returned an empty completed video.");
    return bytes;
  }
  throw new Error("Agnes completed video could not be downloaded.");
}

async function normalizeCompletedSegment(
  state: AgnesJobState,
  segmentIndex: number,
  completedUrl: string,
): Promise<string> {
  const segment = state.segments[segmentIndex]!;
  const dir = await mkdtemp(join(tmpdir(), "agnes-video-"));
  try {
    const sourcePath = join(dir, "provider.mp4");
    const normalizedPath = join(dir, "normalized.mp4");
    await writeFile(sourcePath, await fetchProviderVideo(completedUrl));
    await normalizeGeneratedVisual(
      sourcePath,
      normalizedPath,
      segment.targetDuration,
      state.aspectRatio,
    );
    const bytes = await readFile(normalizedPath);
    const saved = await storage.saveUpload(bytes, `agnes-segment-${segmentIndex + 1}.mp4`, "video/mp4");
    return saved.publicUrl;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function jobProgress(state: AgnesJobState): number {
  if (!state.segments.length) return 0;
  const completed = state.segments.filter((segment) => Boolean(segment.outputUrl)).length;
  return Math.min(99, Math.round((completed / state.segments.length) * 100));
}

export function agnesJobProgress(record: JobRecord): number {
  return isAgnesState(record.providerState) ? jobProgress(record.providerState) : 0;
}

export async function startAgnesVideo(
  req: AgnesGenerationRequest,
  sourceMode: "textToVideo" | "imageToVideo",
): Promise<GenerationTask> {
  const prompt = (req.promptText ?? req.prompt ?? "").trim();
  if (!prompt) throw new Error("A video prompt is required.");
  const duration = requireTimelineDuration(req.duration);
  const initialImage = sourceImage(req);
  if (sourceMode === "imageToVideo" && !initialImage) {
    throw new Error("Image-to-video generation requires a reference image.");
  }

  const segments = splitTimelineDuration(duration).map((segment) => ({ ...segment }));
  const state: AgnesJobState = {
    kind: "agnes-video-v2.0",
    targetDuration: duration,
    aspectRatio: requestedAspectRatio(req),
    sourceMode,
    ...(initialImage ? { imageSourceUrl: initialImage } : {}),
    currentSegment: 0,
    segments,
  };
  const jobId = `agnes_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  await writeJobToDisk(jobId, {
    status: "pending",
    provider: "agnes",
    prompt,
    createdAt: now,
    updatedAt: now,
    providerState: state,
  });

  try {
    const imageUrl = initialImage ? await agnesImageUrl(initialImage) : undefined;
    const ids = await createSegment(state, 0, prompt, imageUrl);
    state.segments[0] = {
      ...state.segments[0]!,
      videoId: ids.videoId,
      taskId: ids.taskId,
      startedAt: Date.now(),
      lastPollAt: 0,
    };
    await writeJobToDisk(jobId, {
      status: "running",
      provider: "agnes",
      prompt,
      createdAt: now,
      updatedAt: Date.now(),
      providerState: state,
    });
    return { id: encodeTaskId({ source: "agnes", id: jobId }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobToDisk(jobId, {
      status: "failed",
      provider: "agnes",
      prompt,
      error: message,
      createdAt: now,
      updatedAt: Date.now(),
      providerState: state,
    });
    throw error;
  }
}

export async function refreshAgnesJob(jobId: string): Promise<JobRecord | null> {
  const record = await readJobFromDisk(jobId);
  if (!record || record.provider !== "agnes" || record.status !== "running") return record;
  if (!isAgnesState(record.providerState)) {
    const failed = { ...record, status: "failed" as const, error: "Agnes job state is invalid.", updatedAt: Date.now() };
    await writeJobToDisk(jobId, failed);
    return failed;
  }

  const state = record.providerState;
  const segmentIndex = state.currentSegment;
  const segment = state.segments[segmentIndex];
  if (!segment?.videoId || !segment.startedAt) {
    const failed = { ...record, status: "failed" as const, error: "Agnes job is missing its active video identifier.", updatedAt: Date.now() };
    await writeJobToDisk(jobId, failed);
    return failed;
  }

  const now = Date.now();
  if (now - segment.startedAt >= POLL_TIMEOUT_MS) {
    const failed = { ...record, status: "failed" as const, error: "Agnes video generation timed out after 360 seconds.", updatedAt: now };
    await writeJobToDisk(jobId, failed);
    return failed;
  }
  if (segment.lastPollAt && now - segment.lastPollAt < POLL_INTERVAL_MS) return record;

  try {
    segment.lastPollAt = now;
    const result = await getAgnesResultOnce(
      { videoId: segment.videoId, taskId: segment.taskId ?? null },
      agnesApiKey(),
    );
    if (result.kind === "waiting") {
      const updated = { ...record, providerState: state, updatedAt: now };
      await writeJobToDisk(jobId, updated);
      return updated;
    }

    segment.outputUrl = await normalizeCompletedSegment(state, segmentIndex, result.url);

    if (segmentIndex + 1 < state.segments.length) {
      const frame = await extractLastFrame(segment.outputUrl);
      const continuityImage = await agnesImageUrl(frame.url);
      const nextIndex = segmentIndex + 1;
      const ids = await createSegment(state, nextIndex, record.prompt, continuityImage);
      state.currentSegment = nextIndex;
      state.segments[nextIndex] = {
        ...state.segments[nextIndex]!,
        videoId: ids.videoId,
        taskId: ids.taskId,
        startedAt: Date.now(),
        lastPollAt: 0,
      };
      const updated = { ...record, providerState: state, updatedAt: Date.now() };
      await writeJobToDisk(jobId, updated);
      return updated;
    }

    const outputs = state.segments.map((item) => item.outputUrl).filter((url): url is string => Boolean(url));
    if (outputs.length !== state.segments.length) throw new Error("Agnes segment assembly is missing generated media.");
    const finalUrl = outputs.length === 1
      ? outputs[0]!
      : (await stitchVideoSegments(jobId, outputs, {
          aspectRatio: state.aspectRatio,
          targetDuration: state.targetDuration,
          fps: 24,
        })).url;

    const completed: JobRecord = {
      ...record,
      status: "completed",
      video_url: finalUrl,
      providerState: state,
      updatedAt: Date.now(),
    };
    await writeJobToDisk(jobId, completed);
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed: JobRecord = {
      ...record,
      status: "failed",
      error: message,
      providerState: state,
      updatedAt: Date.now(),
    };
    await writeJobToDisk(jobId, failed);
    return failed;
  }
}
