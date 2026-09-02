import type {
  ImageToVideoRequest,
  LipSyncRequest,
  PerformanceRequest,
  TextToImageRequest,
  TextToVideoRequest,
} from "@mvs/shared";
import { config } from "./config.js";
import { createAgnesImage, createAgnesReferenceVideo, createAgnesStandardVideo, getAgnesResultOnce } from "./agnes_http.js";
import type { AgnesCreateIds } from "./agnes_core.js";
import { ratioFromLegacyValue } from "./agnes_core.js";
import { sliceAudio } from "./audio_slice.js";
import { extractLastFrame } from "./frames.js";
import { assertSafeHost } from "./net.js";
import { storage } from "./storage.js";
import {
  decodeTaskId,
  encodeTaskId,
  readJobFromDisk,
  writeJobToDisk,
  type GenerationTask,
  type JobRecord,
} from "./generationJobs.js";

type AgnesJobState = { ids: AgnesCreateIds };
type VideoRequest = ImageToVideoRequest | TextToVideoRequest;

function apiKey(): string {
  const value = config.AGNES_API_KEY?.trim();
  if (!value) throw new Error("AGNES_API_KEY is not configured. Agnes generation is offline.");
  return value;
}

function promptFrom(req: { prompt?: string; promptText?: string }, fallback = ""): string {
  const prompt = (req.promptText ?? req.prompt ?? fallback).trim();
  if (!prompt) throw new Error("A generation prompt is required.");
  return prompt;
}

function durationFrom(value: unknown, maximum = 5): number {
  const duration = Number(value ?? 5);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Generation duration must be positive.");
  return Math.min(maximum, duration);
}

function ratioFrom(req: { aspectRatio?: string; ratio?: string }): string {
  return ratioFromLegacyValue(req.aspectRatio ?? req.ratio);
}

async function providerMediaUrl(rawUrl: string): Promise<string> {
  const playable = await storage.playableUrl(rawUrl.trim());
  const publicBaseUrl = config.PUBLIC_BASE_URL ?? config.RENDER_EXTERNAL_URL;
  const absolute = playable.startsWith("/")
    ? new URL(playable, `${publicBaseUrl?.replace(/\/$/, "") || "http://localhost:3001"}/`).toString()
    : playable;
  const parsed = new URL(absolute);
  if (parsed.protocol !== "https:") {
    throw new Error("Agnes media references require a public HTTPS URL. Set PUBLIC_BASE_URL to the deployed HTTPS service URL.");
  }
  await assertSafeHost(absolute);
  return absolute;
}

function jobId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function startVideoJob(prefix: string, prompt: string, create: () => Promise<AgnesCreateIds>): Promise<GenerationTask> {
  const id = jobId(prefix);
  const now = Date.now();
  await writeJobToDisk(id, { status: "pending", prompt, progress: 0, createdAt: now, updatedAt: now });
  try {
    const ids = await create();
    await writeJobToDisk(id, {
      status: "running",
      prompt,
      progress: 0,
      createdAt: now,
      updatedAt: Date.now(),
      providerState: { ids } satisfies AgnesJobState,
    });
    return { id: encodeTaskId({ source: "agnes", id }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobToDisk(id, { status: "failed", prompt, error: message, progress: 100, createdAt: now, updatedAt: Date.now() });
    throw error;
  }
}

export async function imageToVideo(req: VideoRequest): Promise<GenerationTask> {
  const prompt = promptFrom(req);
  const duration = durationFrom(req.duration);
  const source = "imageUrl" in req ? req.promptImage ?? req.imageUrl : undefined;
  const imageUrl = typeof source === "string" && source.trim()
    ? await providerMediaUrl(source)
    : undefined;
  return startVideoJob("agnes_video", prompt, () => createAgnesStandardVideo({
    prompt,
    duration,
    aspectRatio: ratioFrom(req),
    ...(imageUrl ? { imageUrl } : {}),
  }, apiKey()));
}

function referenceUris(req: TextToImageRequest): string[] {
  const references = (req as TextToImageRequest & { referenceImages?: Array<{ uri?: string } | string> }).referenceImages;
  if (!Array.isArray(references)) return [];
  return references.map((item) => typeof item === "string" ? item : item?.uri ?? "").filter(Boolean);
}

export async function generateCharacterFrame(req: TextToImageRequest): Promise<GenerationTask> {
  const prompt = promptFrom(req);
  const id = jobId("agnes_image");
  const now = Date.now();
  await writeJobToDisk(id, { status: "pending", prompt, progress: 0, createdAt: now, updatedAt: now });
  try {
    const referenceImages = await Promise.all(referenceUris(req).slice(0, 5).map(providerMediaUrl));
    const imageUrl = await createAgnesImage({
      prompt,
      ratio: ratioFromLegacyValue(req.ratio),
      ...(referenceImages.length ? { referenceImages } : {}),
    }, apiKey());
    await writeJobToDisk(id, { status: "completed", prompt, image_url: imageUrl, progress: 100, createdAt: now, updatedAt: Date.now() });
    return { id: encodeTaskId({ source: "agnes", id }), imageUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobToDisk(id, { status: "failed", prompt, error: message, progress: 100, createdAt: now, updatedAt: Date.now() });
    throw error;
  }
}

async function slicedAudioUrl(audioUrl: string, start: number, end: number): Promise<string> {
  const slice = await sliceAudio(audioUrl, start, end);
  return providerMediaUrl(slice.url);
}

export async function generatePerformance(req: PerformanceRequest): Promise<GenerationTask> {
  const prompt = promptFrom(req, "A cinematic close-up music-video performance with stable identity and natural expressive motion.");
  const start = Math.max(0, Number(req.audioStart ?? 0));
  const duration = durationFrom(req.audioEnd != null ? Number(req.audioEnd) - start : req.duration);
  const end = start + duration;
  const [imageUrl, audioUrl] = await Promise.all([
    providerMediaUrl(req.imageUrl),
    slicedAudioUrl(req.audioUrl, start, end),
  ]);
  const referencePrompt = `Use <Picture 1> as the performer identity and <Audio 1> as the exact rhythm and vocal reference. ${prompt}`;
  return startVideoJob("agnes_performance", referencePrompt, () => createAgnesReferenceVideo({
    prompt: referencePrompt,
    duration,
    aspectRatio: ratioFromLegacyValue(req.aspectRatio),
    imageUrls: [imageUrl],
    audioUrls: [audioUrl],
  }, apiKey()));
}

export async function animateLipSync(req: LipSyncRequest): Promise<GenerationTask> {
  const audioSource = req.audioUri ?? req.audioUrl;
  if (!audioSource) throw new Error("Lip-sync requires an audio URL.");
  if (!req.videoUrl) throw new Error("Lip-sync requires a performance video URL.");
  const prompt = promptFrom(req, "The performer sings naturally to the supplied vocal with stable identity and accurate expressive mouth movement.");
  const start = Math.max(0, Number(req.audioStart ?? 0));
  const duration = durationFrom(req.audioEnd != null ? Number(req.audioEnd) - start : 5, 12);
  const [frame, audioUrl] = await Promise.all([
    extractLastFrame(req.videoUrl, 0.1),
    slicedAudioUrl(audioSource, start, start + duration),
  ]);
  const imageUrl = await providerMediaUrl(frame.url);
  const referencePrompt = `Use <Picture 1> as the performance and identity reference and synchronize the new motion to <Audio 1>. ${prompt}`;
  return startVideoJob("agnes_lipdub", referencePrompt, () => createAgnesReferenceVideo({
    prompt: referencePrompt,
    duration,
    aspectRatio: "16:9",
    imageUrls: [imageUrl],
    audioUrls: [audioUrl],
  }, apiKey()));
}

function agnesState(record: JobRecord): AgnesJobState | null {
  const state = record.providerState as Partial<AgnesJobState> | undefined;
  return state?.ids?.videoId && state.ids.model ? state as AgnesJobState : null;
}

export async function refreshAgnesJob(id: string): Promise<JobRecord | null> {
  const record = await readJobFromDisk(id);
  if (!record || record.status !== "running") return record;
  const state = agnesState(record);
  if (!state) {
    const failed = { ...record, status: "failed" as const, progress: 100, error: "Agnes job state is missing.", updatedAt: Date.now() };
    await writeJobToDisk(id, failed);
    return failed;
  }
  try {
    const result = await getAgnesResultOnce(state.ids, apiKey());
    if (result.kind === "waiting") {
      const updated = { ...record, progress: result.progress, updatedAt: Date.now() };
      await writeJobToDisk(id, updated);
      return updated;
    }
    const completed = { ...record, status: "completed" as const, progress: 100, video_url: result.url, updatedAt: Date.now() };
    await writeJobToDisk(id, completed);
    return completed;
  } catch (error) {
    const failed = {
      ...record,
      status: "failed" as const,
      progress: 100,
      error: error instanceof Error ? error.message : String(error),
      updatedAt: Date.now(),
    };
    await writeJobToDisk(id, failed);
    return failed;
  }
}

export { decodeTaskId, readJobFromDisk, writeJobToDisk };
