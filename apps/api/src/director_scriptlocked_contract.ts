import { z } from "zod";

export const ScriptLockedReferenceKind = z.enum(["character", "style", "location", "shot", "note"]);

export const ScriptLockedReferenceSchema = z.object({
  id: z.string().min(1).max(200),
  kind: ScriptLockedReferenceKind,
  name: z.string().min(1).max(500),
  description: z.string().default(""),
}).strict();

export const ScriptLockedShotSchema = z.object({
  clipId: z.string().min(1).max(200),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  sourceText: z.string().min(1),
  visualDirection: z.string().default(""),
  cameraDirection: z.string().default(""),
  audioCue: z.string().default(""),
  onScreenText: z.string().default(""),
  selectedCharacterIds: z.array(z.string().min(1)).default([]),
  selectedReferenceIds: z.array(z.string().min(1)).default([]),
}).strict().refine((shot) => shot.end > shot.start, "shot end must be after start");

export const ScriptLockedCompileRequestSchema = z.object({
  projectId: z.string().min(1).max(500),
  visionMode: z.literal("structured"),
  shots: z.array(ScriptLockedShotSchema).min(1).max(80),
  references: z.array(ScriptLockedReferenceSchema).max(80).default([]),
  mustInclude: z.string().default(""),
  avoid: z.string().default(""),
}).strict();

export const ScriptLockedCompiledShotSchema = z.object({
  clipId: z.string().min(1).max(200),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  sourceText: z.string().min(1),
  agnesPrompt: z.string().trim().min(1),
  selectedCharacterIds: z.array(z.string().min(1)),
  selectedReferenceIds: z.array(z.string().min(1)),
  continuityConstraints: z.array(z.string()),
  compilerNotes: z.array(z.string()),
}).strict();

export const ScriptLockedCompileResponseSchema = z.object({
  compiler: z.enum(["videodb-scriptlocked-agnes-v1", "node-script-preserving-fallback-v1"]),
  shots: z.array(ScriptLockedCompiledShotSchema).min(1).max(80),
}).strict();

export const ScriptLockedEditRequestSchema = z.object({
  projectId: z.string().min(1).max(500),
  target: z.literal("agnes_instruction"),
  clipId: z.string().min(1).max(200),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  sourceText: z.string().min(1),
  currentAgnesPrompt: z.string().min(1),
  selectedCharacterIds: z.array(z.string().min(1)).default([]),
  selectedReferenceIds: z.array(z.string().min(1)).default([]),
  continuityConstraints: z.array(z.string()).default([]),
  userMessage: z.string().trim().min(1),
}).strict().refine((request) => request.end > request.start, "edit end must be after start");

export const ScriptLockedEditResponseSchema = z.object({
  clipId: z.string().min(1).max(200),
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  sourceText: z.string().min(1),
  agnesPrompt: z.string().trim().min(1),
  compilerNotes: z.array(z.string()),
}).strict();

export type ScriptLockedReference = z.infer<typeof ScriptLockedReferenceSchema>;
export type ScriptLockedShot = z.infer<typeof ScriptLockedShotSchema>;
export type ScriptLockedCompileRequest = z.infer<typeof ScriptLockedCompileRequestSchema>;
export type ScriptLockedCompiledShot = z.infer<typeof ScriptLockedCompiledShotSchema>;
export type ScriptLockedCompileResponse = z.infer<typeof ScriptLockedCompileResponseSchema>;
export type ScriptLockedEditRequest = z.infer<typeof ScriptLockedEditRequestSchema>;
export type ScriptLockedEditResponse = z.infer<typeof ScriptLockedEditResponseSchema>;

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateCompileResponse(
  rawRequest: ScriptLockedCompileRequest,
  rawResponse: unknown,
): ScriptLockedCompileResponse {
  const request = ScriptLockedCompileRequestSchema.parse(rawRequest);
  const response = ScriptLockedCompileResponseSchema.parse(rawResponse);
  if (response.shots.length !== request.shots.length) {
    throw new Error(`Script-Locked response violates exact source: expected ${request.shots.length} shots, received ${response.shots.length}`);
  }

  const sourceById = new Map(request.shots.map((shot) => [shot.clipId, shot]));
  const seen = new Set<string>();
  const validReferenceIds = new Set(request.references.map((reference) => reference.id));

  for (const output of response.shots) {
    if (seen.has(output.clipId)) throw new Error(`Script-Locked response violates exact source: duplicate clipId ${output.clipId}`);
    seen.add(output.clipId);
    const source = sourceById.get(output.clipId);
    if (!source) throw new Error(`Script-Locked response violates exact source: unknown clipId ${output.clipId}`);
    if (output.start !== source.start || output.end !== source.end || output.sourceText !== source.sourceText) {
      throw new Error(`Script-Locked response violates exact source for ${output.clipId}`);
    }
    if (!sameArray(output.selectedCharacterIds, source.selectedCharacterIds)) {
      throw new Error(`Script-Locked response changed selected characters for ${output.clipId}`);
    }
    if (!sameArray(output.selectedReferenceIds, source.selectedReferenceIds)) {
      throw new Error(`Script-Locked response changed selected references for ${output.clipId}`);
    }
    for (const id of [...output.selectedCharacterIds, ...output.selectedReferenceIds]) {
      if (!validReferenceIds.has(id)) throw new Error(`Script-Locked response returned unknown reference ${id}`);
    }
  }

  for (const source of request.shots) {
    if (!seen.has(source.clipId)) throw new Error(`Script-Locked response violates exact source: missing clipId ${source.clipId}`);
  }
  return response;
}

export function validateEditResponse(
  request: ScriptLockedEditRequest,
  rawResponse: unknown,
): ScriptLockedEditResponse {
  const parsed = ScriptLockedEditResponseSchema.parse(rawResponse);
  if (
    parsed.clipId !== request.clipId ||
    parsed.start !== request.start ||
    parsed.end !== request.end ||
    parsed.sourceText !== request.sourceText
  ) {
    throw new Error(`Script-Locked edit violates exact source for ${request.clipId}`);
  }
  return parsed;
}
