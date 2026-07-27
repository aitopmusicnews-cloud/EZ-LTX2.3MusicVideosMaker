import type {
  AudioAnalysis,
  ImageToVideoRequest,
  VideoToVideoRequest,
  LipSyncRequest,
  TextToImageRequest,
  TextToVideoRequest,
  ProjectMeta,
  SavedProject,
  RenderEntry,
  SavedClip,
  SavedImage,
  LibraryFolder,
  Task,
} from "@mvs/shared";
export type { ProjectMeta, SavedProject, RenderEntry, SavedClip, SavedImage, LibraryFolder };

export class ApiError extends Error {
  status: number;
  rateLimited: boolean;
  constructor(status: number, message: string, rateLimited = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let parsed: { error?: string; rateLimited?: boolean } | null = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error ?? text;
    throw new ApiError(res.status, msg, parsed?.rateLimited === true);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err: any) {
    if (text.trim().startsWith("<!doctype") || text.trim().startsWith("<html") || text.trim().startsWith("<!DOCTYPE")) {
      const sample = text.substring(0, 150).replace(/\s+/g, " ");
      throw new Error(`API returned an HTML page instead of JSON (Status ${res.status}): "${sample}..."`);
    }
    throw new Error(`Invalid JSON response from server (Status ${res.status}): ${err.message}. Response: "${text.substring(0, 150)}..."`);
  }
}

function arrayFromPayload<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const nested = (payload as Record<string, unknown>)[key];
    if (Array.isArray(nested)) return nested as T[];
  }
  console.warn(`[API] Expected an array or { ${key}: [...] } response`, payload);
  return [];
}

export async function uploadSong(file: File): Promise<{ id: string; audioUrl: string; filename: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/songs/upload", { method: "POST", body: fd }));
}

export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/images/upload", { method: "POST", body: fd }));
}

export async function uploadVideo(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/videos/upload", { method: "POST", body: fd }));
}

export async function extractLastFrame(videoUrl: string, time?: number): Promise<{ url: string }> {
  return jsonOrThrow(await fetch("/api/videos/extract-last-frame", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoUrl, time }) }));
}

export async function sliceAudio(audioUrl: string, start: number, end: number): Promise<{ url: string }> {
  return jsonOrThrow(await fetch("/api/audio/slice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audioUrl, start, end }) }));
}

export async function getAnalysis(songId: string): Promise<{ status: "pending" | "ready" | "failed"; analysis?: AudioAnalysis; error?: string }> {
  return jsonOrThrow(await fetch(`/api/songs/${songId}/analysis`));
}

export async function pollAnalysis(songId: string, intervalMs = 2000, timeoutMs = 120_000): Promise<AudioAnalysis> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await getAnalysis(songId);
    if (res.status === "ready" && res.analysis) return res.analysis;
    if (res.status === "failed") throw new Error(res.error ?? "analysis failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("analysis timed out");
}

export async function startImageToVideo(req: Record<string, any>): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/image-to-video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function startVideoToVideo(req: Record<string, any>): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/video-to-video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function startLipSync(req: Record<string, any>): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/lip-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function startTextToImage(req: Record<string, any>): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function startTextToVideo(req: Record<string, any>): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function ensureVocalStem(songIdOrUrl: string): Promise<{ url: string; vocalUrl: string }> {
  try {
    const res = await jsonOrThrow<{ url?: string; vocalUrl?: string }>(await fetch("/api/songs/vocal-stem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ songId: songIdOrUrl.startsWith("http") || songIdOrUrl.startsWith("/") ? undefined : songIdOrUrl, audioUrl: songIdOrUrl }) }));
    const u = res.url || res.vocalUrl || songIdOrUrl;
    return { url: u, vocalUrl: u };
  } catch {
    return { url: songIdOrUrl, vocalUrl: songIdOrUrl };
  }
}

export async function getTask(id: string): Promise<Task> {
  return jsonOrThrow(await fetch(`/api/tasks/${id}`));
}

export async function pollTask(id: string, intervalMs = 2500, timeoutMs = 600_000): Promise<Task> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getTask(id);
    const statusUpper = (t.status || "").toUpperCase();
    if (statusUpper === "SUCCEEDED" || statusUpper === "FAILED" || statusUpper === "CANCELLED") return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("task timed out");
}

export type RenderRequest = { projectId: string; audioUrl: string; duration: number; clips: Array<{ start: number; end: number; videoUrl: string; source?: string }>; fades?: boolean };
export type RenderJobState = "queued" | "running" | "succeeded" | "failed";
export interface RenderJob { id: string; state: RenderJobState; enqueuedAt: number; startedAt: number | null; completedAt: number | null; url: string | null; error: string | null; queuePosition: number | null; }
export interface RenderSubmitResponse { renderId: string; state: RenderJobState; queuePosition: number | null; }

export async function renderTimeline(req: RenderRequest, options?: { onUpdate?: (job: RenderJob) => void }): Promise<{ url: string; renderId: string }> {
  const submitRes = await jsonOrThrow<RenderSubmitResponse>(await fetch("/api/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
  const start = Date.now();
  while (Date.now() - start < 600_000) {
    const job = await jsonOrThrow<RenderJob>(await fetch(`/api/render/jobs/${encodeURIComponent(submitRes.renderId)}`));
    options?.onUpdate?.(job);
    if (job.state === "succeeded") return { url: job.url ?? `/storage/renders/${submitRes.renderId}.mp4`, renderId: submitRes.renderId };
    if (job.state === "failed") throw new Error(job.error ?? "render failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("render timed out");
}
