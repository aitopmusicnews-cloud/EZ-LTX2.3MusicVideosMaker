export const AGNES_CREATE_URL = "https://apihub.agnes-ai.com/v1/videos";
export const AGNES_STATUS_URL = "https://apihub.agnes-ai.com/agnesapi";
export const AGNES_MODEL = "agnes-video-v2.0";
export const AGNES_FRAME_RATE = 24;
export const AGNES_MAX_FRAMES = 441;
export const AGNES_MAX_SEGMENT_DURATION = AGNES_MAX_FRAMES / AGNES_FRAME_RATE;

export type AgnesCreateIds = {
  videoId: string;
  taskId: string | null;
};

export type AgnesDurationSegment = {
  targetDuration: number;
  numFrames: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function requireTimelineDuration(value: unknown): number {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Video generation duration must be a positive finite timeline duration.");
  }
  return duration;
}

export function frameCountForDuration(targetDuration: number): number {
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
    throw new Error("Agnes target duration must be a positive finite number.");
  }

  const minimumFrames = Math.max(1, Math.ceil(targetDuration * AGNES_FRAME_RATE));
  const n = Math.ceil((minimumFrames - 1) / 8);
  const frames = 8 * n + 1;
  if (frames > AGNES_MAX_FRAMES) {
    throw new Error(
      `Agnes target duration ${targetDuration.toFixed(3)}s exceeds the ${AGNES_MAX_FRAMES}-frame limit.`,
    );
  }
  return frames;
}

export function splitTimelineDuration(targetDuration: number): AgnesDurationSegment[] {
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
    throw new Error("Timeline clip duration must be a positive finite number.");
  }

  const segmentCount = Math.max(1, Math.ceil(targetDuration / AGNES_MAX_SEGMENT_DURATION));
  const nominalDuration = targetDuration / segmentCount;
  const segments: AgnesDurationSegment[] = [];
  let assigned = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const segmentDuration = index === segmentCount - 1
      ? targetDuration - assigned
      : nominalDuration;
    assigned += segmentDuration;
    segments.push({
      targetDuration: segmentDuration,
      numFrames: frameCountForDuration(segmentDuration),
    });
  }

  return segments;
}

export function isAgnesWaitStatus(status: string): boolean {
  return status === "pending" || status === "queued" || status === "in_progress";
}

export function parseAgnesCreateIds(payload: unknown): AgnesCreateIds {
  if (!isRecord(payload)) throw new Error("Agnes create response was not an object.");
  const videoId = typeof payload.video_id === "string" ? payload.video_id.trim() : "";
  if (!videoId) throw new Error("Agnes create response did not include video_id.");
  const taskId = typeof payload.task_id === "string" && payload.task_id.trim()
    ? payload.task_id.trim()
    : null;
  return { videoId, taskId };
}

export function preferredAgnesResultUrl(videoId: string): string {
  const url = new URL(AGNES_STATUS_URL);
  url.searchParams.set("video_id", videoId);
  url.searchParams.set("model_name", AGNES_MODEL);
  return url.toString();
}

export function validCompletedMetadataUrl(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.metadata)) return null;
  const value = payload.metadata.url;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
