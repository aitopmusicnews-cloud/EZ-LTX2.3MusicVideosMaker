export const AGNES_BASE_URL = "https://apihub.agnes-ai.com";
export const AGNES_IMAGE_URL = `${AGNES_BASE_URL}/v1/images/generations`;
export const AGNES_VIDEO_URL = `${AGNES_BASE_URL}/v1/videos`;
export const AGNES_STATUS_URL = `${AGNES_BASE_URL}/agnesapi`;

export const AGNES_IMAGE_MODEL = "agnes-image-2.5-flash";
export const AGNES_STANDARD_VIDEO_MODEL = "agnes-video-v2.0";
export const AGNES_REFERENCE_VIDEO_MODEL = "agnes-video-2.5-flash";
export const AGNES_FRAME_RATE = 24;
export const AGNES_MAX_FRAMES = 441;

export type AgnesVideoModel =
  | typeof AGNES_STANDARD_VIDEO_MODEL
  | typeof AGNES_REFERENCE_VIDEO_MODEL;

export type AgnesCreateIds = {
  videoId: string;
  taskId: string | null;
  model: AgnesVideoModel;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function frameCountForDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Agnes video duration must be a positive finite number.");
  }
  const minimumFrames = Math.max(1, Math.ceil(duration * AGNES_FRAME_RATE));
  const frames = Math.ceil((minimumFrames - 1) / 8) * 8 + 1;
  if (frames > AGNES_MAX_FRAMES) {
    throw new Error(`Agnes video duration exceeds the ${AGNES_MAX_FRAMES}-frame limit.`);
  }
  return frames;
}

const SUPPORTED_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;

export function ratioFromLegacyValue(value: string | undefined): string {
  const cleaned = value?.trim();
  if (!cleaned || cleaned === "auto") return "16:9";
  if ((SUPPORTED_RATIOS as readonly string[]).includes(cleaned)) return cleaned;
  const match = cleaned.match(/^(\d+(?:\.\d+)?)[x:](\d+(?:\.\d+)?)$/i);
  if (!match) return "16:9";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return "16:9";
  const target = width / height;
  return SUPPORTED_RATIOS.reduce((best, candidate) => {
    const [w, h] = candidate.split(":").map(Number);
    const [bestW, bestH] = best.split(":").map(Number);
    return Math.abs(w! / h! - target) < Math.abs(bestW! / bestH! - target) ? candidate : best;
  }, "16:9" as (typeof SUPPORTED_RATIOS)[number]);
}

export function agnesDimensions(ratio: string): { width: number; height: number } {
  switch (ratioFromLegacyValue(ratio)) {
    case "9:16": return { width: 768, height: 1152 };
    case "1:1": return { width: 768, height: 768 };
    case "4:3": return { width: 1024, height: 768 };
    case "3:4": return { width: 768, height: 1024 };
    case "2:3": return { width: 768, height: 1152 };
    case "21:9": return { width: 1344, height: 576 };
    default: return { width: 1152, height: 768 };
  }
}

export function agnesFlashSeconds(duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Agnes video duration must be a positive finite number.");
  }
  return String(Math.min(12, Math.max(4, Math.ceil(duration))));
}

export function parseAgnesCreateIds(payload: unknown, model: AgnesVideoModel): AgnesCreateIds {
  if (!isRecord(payload)) throw new Error("Agnes create response was not an object.");
  const videoId = typeof payload.video_id === "string" ? payload.video_id.trim() : "";
  if (!videoId) throw new Error("Agnes create response did not include video_id.");
  const taskId = typeof payload.task_id === "string" && payload.task_id.trim()
    ? payload.task_id.trim()
    : null;
  return { videoId, taskId, model };
}

export function preferredAgnesResultUrl(videoId: string, model: AgnesVideoModel): string {
  const url = new URL(AGNES_STATUS_URL);
  url.searchParams.set("video_id", videoId);
  url.searchParams.set("model_name", model);
  return url.toString();
}

export function completedAgnesUrl(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.metadata)) return null;
  const raw = payload.metadata.url;
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
