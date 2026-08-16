import type { TextToImageRequest } from "@mvs/shared";
import { config } from "./config.js";
import {
  encodeTaskId,
  readJobFromDisk,
  writeJobToDisk,
  type JobRecord,
  type ModalTask,
} from "./generationJobs.js";

export {
  encodeTaskId,
  readJobFromDisk,
  writeJobToDisk,
  type JobRecord,
  type ModalTask,
} from "./generationJobs.js";

function modalHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.MODAL_KEY && config.MODAL_SECRET) {
    headers["Modal-Key"] = config.MODAL_KEY;
    headers["Modal-Secret"] = config.MODAL_SECRET;
  }
  return headers;
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text || `${response.status} ${response.statusText}`;
}

/** Generate a Director approval image through the retained Modal media-suite endpoint. */
export async function generateCharacterFrame(req: TextToImageRequest): Promise<ModalTask> {
  if (!config.MODAL_MEDIA_SUITE_URL) {
    throw new Error("MODAL_MEDIA_SUITE_URL is not configured in Render.");
  }
  const prompt = (req.promptText ?? req.prompt ?? "").trim();
  if (!prompt) throw new Error("An image prompt is required.");

  const jobId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  await writeJobToDisk(jobId, {
    status: "pending",
    provider: "modal",
    prompt,
    createdAt: now,
    updatedAt: now,
  });

  try {
    const response = await fetch(config.MODAL_MEDIA_SUITE_URL, {
      method: "POST",
      headers: modalHeaders(),
      body: JSON.stringify({ prompt, aspect_ratio: req.ratio ?? "16:9" }),
      signal: AbortSignal.timeout(120_000),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Modal image engine failed: ${await responseError(response)}`);

    const data = (await response.json()) as { url?: string; image_url?: string };
    const imageUrl = data.image_url ?? data.url;
    if (!imageUrl) throw new Error("Modal image engine returned no image URL.");

    await writeJobToDisk(jobId, {
      status: "completed",
      provider: "modal",
      prompt,
      image_url: imageUrl,
      createdAt: now,
      updatedAt: Date.now(),
    });
    return { id: encodeTaskId({ source: "modal", id: jobId }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobToDisk(jobId, {
      status: "failed",
      provider: "modal",
      prompt,
      error: message,
      createdAt: now,
      updatedAt: Date.now(),
    });
    throw error;
  }
}
