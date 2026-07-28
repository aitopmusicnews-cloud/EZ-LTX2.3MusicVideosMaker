import { z } from "zod";
import { config } from "./config.js";
import { encodeTaskId, writeJobToDisk } from "./modalAI.js";

const DirectorSegmentSchema = z.object({
  prompt: z.string().min(1),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
}).refine((segment) => segment.end > segment.start, "segment end must be after start");

const GeminiSegmentsSchema = z.object({
  segments: z.array(DirectorSegmentSchema).min(1).max(16),
});

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

type DirectorSegment = z.infer<typeof DirectorSegmentSchema>;

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

function normalizeSegments(segments: DirectorSegment[], duration: number): DirectorSegment[] {
  const ordered = [...segments]
    .map((segment) => ({
      prompt: segment.prompt.trim(),
      start: Math.max(0, Math.min(duration, Number(segment.start))),
      end: Math.max(0, Math.min(duration, Number(segment.end))),
    }))
    .filter((segment) => segment.prompt && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  if (ordered.length === 0) return [];
  ordered[0]!.start = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    ordered[index]!.start = ordered[index - 1]!.end;
    if (ordered[index]!.end <= ordered[index]!.start) {
      ordered[index]!.end = Math.min(duration, ordered[index]!.start + Math.max(0.25, duration / ordered.length));
    }
  }
  ordered[ordered.length - 1]!.end = duration;
  return ordered.filter((segment) => segment.end > segment.start);
}

function extractGeminiText(payload: unknown): string {
  const candidates = (payload as any)?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").trim();
}

function parseGeminiJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Gemini returned invalid Director timeline JSON.");
  }
}

async function expandDirectorSegments(req: DirectorRenderSectionRequest): Promise<DirectorSegment[]> {
  const supplied = normalizeSegments(req.segments ?? [], req.duration);
  if (supplied.length > 0) return supplied;

  const fallback = [{ prompt: req.prompt.trim(), start: 0, end: req.duration }];
  if (!config.GEMINI_API_KEY) return fallback;

  const requestedSegments = Math.max(1, Math.min(12, Math.round(req.duration / 4)));
  const instruction = [
    "You translate an approved music-video section into the internal timeline used by an LTXDirector node.",
    "Do not rewrite the creative concept or add a new scene. Preserve the approved global direction and shot prompt.",
    `The section is exactly ${req.duration.toFixed(3)} seconds long.`,
    `Create about ${requestedSegments} chronological visual beats, using fewer when the action does not need more cuts.`,
    "Return JSON only: {\"segments\":[{\"start\":number,\"end\":number,\"prompt\":string}]}",
    "Times are seconds relative to the start of this section. The first start must be 0, segments must be contiguous and non-overlapping, and the final end must equal the exact section duration.",
    "Each prompt must be literal and visually observable. Describe what changes during that beat: performer action/expression, environment, camera/framing/movement, lighting, and continuity-relevant details.",
    "Do not add screenplay headings, model parameters, markdown, or commentary.",
    `GLOBAL DIRECTION:\n${req.globalPrompt}`,
    `APPROVED SECTION (${req.sectionLabel}):\n${req.prompt}`,
  ].join("\n\n");

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.GEMINI_DIRECTOR_MODEL)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": config.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }] }],
        generationConfig: { maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = JSON.parse(await response.text());
    const modelText = extractGeminiText(payload);
    if (!modelText) throw new Error("Gemini returned no Director timeline segments.");
    const parsed = GeminiSegmentsSchema.parse(parseGeminiJson(modelText));
    const normalized = normalizeSegments(parsed.segments, req.duration);
    return normalized.length > 0 ? normalized : fallback;
  } catch (error) {
    console.warn("[Director Render] Gemini segment expansion failed; using the approved section prompt as one LTXDirector segment.", error);
    return fallback;
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
  const segments = await expandDirectorSegments(req);
  const body = {
    job_id: jobId,
    webhook_url: webhookUrl,
    project_id: req.projectId,
    clip_id: req.clipId,
    section_label: req.sectionLabel,
    global_prompt: req.globalPrompt,
    prompt,
    duration: req.duration,
    segments,
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
  return { id: encodeTaskId({ source: "modal", id: jobId }) };
}
