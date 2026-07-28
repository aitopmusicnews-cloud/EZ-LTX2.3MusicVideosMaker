import { z } from "zod";
import { config } from "./config.js";
import { encodeTaskId, writeJobToDisk } from "./modalAI.js";

const DirectorSegmentSchema = z.object({
  prompt: z.string().min(1),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
}).refine((segment) => segment.end > segment.start, "segment end must be after start");

export const DirectorRenderSectionSchema = z.object({
  projectId: z.string().min(1).max(200).optional(),
  clipId: z.string().min(1).max(200),
  sectionLabel: z.string().min(1).max(300),
  globalPrompt: z.string().min(1),
  prompt: z.string().min(1),
  duration: z.number().finite().positive().max(120),
  segments: z.array(DirectorSegmentSchema).max(40).optional(),
  conditioningImageUrl: z.string().url().optional(),
  requiresCharacter: z.boolean().default(false),
  width: z.number().int().min(256).max(2048).optional(),
  height: z.number().int().min(256).max(2048).optional(),
  fps: z.number().finite().min(1).max(60).default(24),
  seed: z.number().int().nonnegative().optional(),
  epsilon: z.number().finite().min(0.0001).max(0.99).default(0.99),
});

export type DirectorRenderSectionRequest = z.infer<typeof DirectorRenderSectionSchema>;

function engineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.LTX_DIRECTOR_TOKEN) headers.authorization = `Bearer ${config.LTX_DIRECTOR_TOKEN}`;
  return headers;
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as { error?: string; detail?: string };
    return parsed.error ?? parsed.detail ?? text;
  } catch {
    return text.slice(0, 2000);
  }
}

export async function startDirectorSectionRender(
  raw: unknown,
  callbackBaseUrl: string,
): Promise<{ id: string }> {
  const req = DirectorRenderSectionSchema.parse(raw);
  if (!config.LTX_DIRECTOR_URL) {
    throw new Error(
      "LTX_DIRECTOR_URL is not configured. Deploy the ComfyUI LTX Director engine before spending video credits.",
    );
  }
  if (req.requiresCharacter && !req.conditioningImageUrl) {
    throw new Error(
      "Character conditioning is required. Director rendering was blocked because no approved conditioning image was supplied.",
    );
  }

  const prompt = req.prompt.trim();
  const jobId = `director_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  await writeJobToDisk(jobId, { status: "pending", prompt, createdAt: now, updatedAt: now });

  const webhookUrl = `${callbackBaseUrl.replace(/\/$/, "")}/api/modal/webhook`;
  const body = {
    job_id: jobId,
    webhook_url: webhookUrl,
    project_id: req.projectId,
    clip_id: req.clipId,
    section_label: req.sectionLabel,
    global_prompt: req.globalPrompt,
    prompt,
    duration: req.duration,
    segments: req.segments,
    conditioning_image_url: req.conditioningImageUrl,
    requires_character: req.requiresCharacter,
    width: req.width,
    height: req.height,
    fps: req.fps,
    seed: req.seed,
    epsilon: req.epsilon,
  };

  let response: Response;
  try {
    response = await fetch(config.LTX_DIRECTOR_URL, {
      method: "POST",
      headers: engineHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobToDisk(jobId, {
      status: "failed",
      prompt,
      error: `Could not reach LTX Director engine: ${message}`,
      createdAt: now,
      updatedAt: Date.now(),
    });
    throw new Error(`Could not reach the LTX Director engine: ${message}`);
  }

  if (!response.ok) {
    const message = await responseError(response);
    await writeJobToDisk(jobId, {
      status: "failed",
      prompt,
      error: message,
      createdAt: now,
      updatedAt: Date.now(),
    });
    throw new Error(`LTX Director engine rejected the section: ${message}`);
  }

  await writeJobToDisk(jobId, {
    status: "running",
    prompt,
    createdAt: now,
    updatedAt: Date.now(),
  });
  return { id: encodeTaskId({ source: "director", id: jobId }) };
}
