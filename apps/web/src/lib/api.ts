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
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const message = data?.error || data?.message || text || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, res.status === 429);
  }
  return data as T;
}

export async function getAnalysis(songId: string): Promise<{ status: "pending" | "ready" | "failed"; analysis?: AudioAnalysis; error?: string }> {
  return jsonOrThrow(await fetch(`/api/songs/${songId}/analysis`));
}

export async function pollAnalysis(songId: string, intervalMs = 2000, timeoutMs = 600_000): Promise<AudioAnalysis> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await getAnalysis(songId);
    if (res.status === "ready" && res.analysis) return res.analysis;
    if (res.status === "failed") throw new Error(res.error ?? "analysis failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("analysis timed out");
}

export async function startImageToVideo(req: ImageToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/image-to-video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function startVideoToVideo(req: VideoToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/video-to-video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function startLipSync(req: LipSyncRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/lip-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function startTextToImage(req: TextToImageRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function startTextToVideo(req: TextToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }));
}

export async function getTask(id: string): Promise<Task> {
  return jsonOrThrow(await fetch(`/api/tasks/${id}`));
}
