export interface JobRecord {
  status: "pending" | "running" | "completed" | "failed";
  video_url?: string;
  image_url?: string;
  error?: string;
  prompt: string;
  progress?: number;
  createdAt: number;
  updatedAt: number;
  providerState?: unknown;
}

export type GenerationTask = { id: string; imageUrl?: string };
export type TaskIdPayload = { source: "agnes"; id: string };

function jobKey(jobId: string): string {
  return `jobs/${jobId}.json`;
}

export async function writeJobToDisk(jobId: string, record: JobRecord): Promise<void> {
  const { storage } = await import("./storage.js");
  await storage.saveJson(jobKey(jobId), record);
}

export async function readJobFromDisk(jobId: string): Promise<JobRecord | null> {
  try {
    const { storage } = await import("./storage.js");
    return await storage.loadJson<JobRecord>(jobKey(jobId));
  } catch (error) {
    console.error(`[Job Store] Failed to read ${jobId}:`, error);
    return null;
  }
}

export function encodeTaskId(payload: TaskIdPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeTaskId(encoded: string): TaskIdPayload {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (parsed?.source === "agnes" && typeof parsed.id === "string") return parsed as TaskIdPayload;
  } catch {
    // Old unencoded job ids remain readable as local job keys.
  }
  return { source: "agnes", id: encoded };
}
