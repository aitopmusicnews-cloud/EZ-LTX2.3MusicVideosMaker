import { z } from "zod";
import { config } from "./config.js";

const UpdateClipActionSchema = z.object({
  type: z.literal("update_clip"),
  clipId: z.string().min(1),
  prompt: z.string().min(20).optional(),
  continuityNotes: z.string().min(1).optional(),
  transition: z.string().min(1).optional(),
  sectionLabel: z.string().min(1).optional(),
  requiresCharacter: z.boolean().optional(),
  conditioningReferenceId: z.string().nullable().optional(),
  regenerate: z.boolean().default(false),
});

const EditImageActionSchema = z.object({
  type: z.enum(["edit_scene_image", "edit_shot_image"]),
  clipId: z.string().min(1),
  prompt: z.string().min(10),
});

export const DirectorEditActionSchema = z.discriminatedUnion("type", [
  UpdateClipActionSchema,
  EditImageActionSchema,
]);

export type DirectorEditAction = z.infer<typeof DirectorEditActionSchema>;

const DirectorChatRequestSchema = z.object({
  message: z.string().trim().min(2).max(4000),
  plan: z.object({
    treatment: z.unknown().optional(),
    characterBible: z.unknown().optional(),
    shots: z.array(z.object({
      clipId: z.string().min(1),
      sectionLabel: z.string().optional(),
      start: z.number().optional(),
      end: z.number().optional(),
      requiresCharacter: z.boolean().optional(),
      conditioningReferenceId: z.string().nullable().optional(),
      prompt: z.string().optional(),
      continuityNotes: z.string().optional(),
      transition: z.string().optional(),
    }).passthrough()).min(1).max(80),
  }).passthrough(),
  references: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().optional(),
    name: z.string().optional(),
    note: z.string().optional(),
    anchorUrl: z.string().optional(),
  }).passthrough()).max(30).default([]),
  sceneImages: z.record(z.string(), z.string()).default({}),
  shotImages: z.record(z.string(), z.string()).default({}),
  history: z.array(z.object({ role: z.enum(["user", "director"]), text: z.string().max(4000) })).max(12).default([]),
});

const DirectorChatResponseSchema = z.object({
  reply: z.string().min(1),
  actions: z.array(DirectorEditActionSchema).max(12).default([]),
});

function extractGeminiText(payload: unknown): string {
  const candidates = (payload as any)?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return "";
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").trim();
}

function parseJsonObject(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Director chat returned invalid JSON.");
  }
}

function systemInstruction(): string {
  return [
    "You are the conversational editing mode of an LTX music-video Director.",
    "The user is editing an existing plan, not asking for a new plan.",
    "Return JSON only with shape: { reply: string, actions: DirectorEditAction[] }.",
    "Allowed actions are update_clip, edit_scene_image, and edit_shot_image.",
    "For update_clip use only an existing clipId. Include only fields the user asked to change. Set regenerate=true only when the user explicitly asks to regenerate/re-render/retry that video clip.",
    "For edit_scene_image or edit_shot_image, write a complete image-generation prompt describing the requested revision while preserving everything the user did not ask to change.",
    "Never invent clip IDs or reference IDs. Never delete clips. Never change clip timing.",
    "If the request is ambiguous, return a helpful reply with no actions and ask the user to identify the clip or image.",
    "Be concise in reply and describe exactly what will be changed.",
  ].join(" ");
}

export async function chatWithDirector(rawRequest: unknown): Promise<z.infer<typeof DirectorChatResponseSchema>> {
  if (!config.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured in Render.");
  const req = DirectorChatRequestSchema.parse(rawRequest);
  const validClipIds = new Set(req.plan.shots.map((shot) => shot.clipId));
  const validReferenceIds = new Set(req.references.map((reference) => reference.id));

  const context = {
    userMessage: req.message,
    recentConversation: req.history,
    currentPlan: req.plan,
    availableReferences: req.references,
    currentSceneImages: req.sceneImages,
    currentShotImages: req.shotImages,
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.GEMINI_DIRECTOR_MODEL)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction() }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(context, null, 2) }] }],
      generationConfig: { maxOutputTokens: 4096 },
    }),
    signal: AbortSignal.timeout(240_000),
  });

  const responseText = await response.text();
  if (!response.ok) {
    let message = responseText;
    try {
      const parsedError = JSON.parse(responseText)?.error;
      if (parsedError) {
        const details = Array.isArray(parsedError.details) && parsedError.details.length
          ? ` Details: ${JSON.stringify(parsedError.details)}`
          : "";
        message = `${parsedError.message ?? responseText}${details}`;
      }
    } catch {
      // Keep raw response text.
    }
    throw new Error(`Gemini Director chat failed: ${message.slice(0, 1200)}`);
  }

  const modelText = extractGeminiText(JSON.parse(responseText));
  if (!modelText) throw new Error("Gemini Director chat returned no response.");
  const parsed = DirectorChatResponseSchema.parse(parseJsonObject(modelText));

  for (const action of parsed.actions) {
    if (!validClipIds.has(action.clipId)) throw new Error(`Director chat referenced unknown clipId ${action.clipId}.`);
    if (action.type === "update_clip" && action.conditioningReferenceId && !validReferenceIds.has(action.conditioningReferenceId)) {
      throw new Error(`Director chat referenced unknown conditioning asset ${action.conditioningReferenceId}.`);
    }
  }

  return parsed;
}
