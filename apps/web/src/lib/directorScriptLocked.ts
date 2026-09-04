import { parseDirectorVision } from "./directorVisionParser.js";

export type ScriptLockedReference = {
  id: string;
  kind: "character" | "style" | "location" | "shot" | "note";
  name: string;
  description: string;
};

export type ScriptLockedShot = {
  clipId: string;
  start: number;
  end: number;
  sourceText: string;
  visualDirection: string;
  cameraDirection: string;
  audioCue: string;
  onScreenText: string;
  selectedCharacterIds: string[];
  selectedReferenceIds: string[];
};

export type ScriptLockedCompiledShot = {
  clipId: string;
  start: number;
  end: number;
  sourceText: string;
  agnesPrompt: string;
  selectedCharacterIds: string[];
  selectedReferenceIds: string[];
  continuityConstraints: string[];
  compilerNotes: string[];
};

export type ScriptLockedCompileRequest = {
  projectId: string;
  visionMode: "structured";
  shots: ScriptLockedShot[];
  references: ScriptLockedReference[];
  mustInclude: string;
  avoid: string;
};

export type ScriptLockedCompileResponse = {
  compiler: "videodb-scriptlocked-agnes-v1" | "node-script-preserving-fallback-v1";
  shots: ScriptLockedCompiledShot[];
};

export type ScriptLockedEditRequest = {
  projectId: string;
  target: "agnes_instruction";
  clipId: string;
  start: number;
  end: number;
  sourceText: string;
  currentAgnesPrompt: string;
  selectedCharacterIds: string[];
  selectedReferenceIds: string[];
  continuityConstraints: string[];
  userMessage: string;
};

export type ScriptLockedEditResponse = {
  clipId: string;
  start: number;
  end: number;
  sourceText: string;
  agnesPrompt: string;
  compilerNotes: string[];
};

export type ScriptLockedApproval = {
  url: string;
  approved: boolean;
};

export type ScriptLockedDirectorSessionV1 = {
  version: 1;
  sourceVision: string;
  compiledByClip: Record<string, ScriptLockedCompiledShot | undefined>;
  approvedCharacterIds: string[];
  characterSelections: Record<string, string[]>;
  shotApprovals: Record<string, ScriptLockedApproval | undefined>;
  sceneApprovals: Record<string, ScriptLockedApproval | undefined>;
  sectionApprovals: Record<string, ScriptLockedApproval | undefined>;
};

type LegacyMigrationInput = {
  shotApprovals?: unknown;
  sceneApprovals?: unknown;
  sectionApprovals?: unknown;
  approvedCharacterIds?: unknown;
  characterSelections?: unknown;
  legacyPlan?: unknown;
};

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function sanitizeSelections(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([clipId, ids]) => [clipId, uniqueStrings(ids)]),
  );
}

function sanitizeApprovals(value: unknown): Record<string, ScriptLockedApproval | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Array<[string, ScriptLockedApproval]> = [];
  for (const [clipId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim()) {
      entries.push([clipId, { url: raw, approved: true }]);
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.url !== "string" || !candidate.url.trim()) continue;
    entries.push([clipId, { url: candidate.url, approved: candidate.approved === true }]);
  }
  return Object.fromEntries(entries);
}

export function emptyScriptLockedDirectorSession(sourceVision = ""): ScriptLockedDirectorSessionV1 {
  return {
    version: 1,
    sourceVision,
    compiledByClip: {},
    approvedCharacterIds: [],
    characterSelections: {},
    shotApprovals: {},
    sceneApprovals: {},
    sectionApprovals: {},
  };
}

export function buildScriptLockedShots(
  vision: string,
  characterSelections: Record<string, string[]> = {},
  referenceSelections: Record<string, string[]> = {},
): ScriptLockedShot[] {
  const parsed = parseDirectorVision(vision);
  if (parsed.mode !== "structured") return [];

  return parsed.shots.map((shot, index) => {
    const clipId = `vision-shot-${index + 1}`;
    const selectedCharacterIds = uniqueStrings(characterSelections[clipId]);
    const selectedReferenceIds = uniqueStrings([
      ...selectedCharacterIds,
      ...uniqueStrings(referenceSelections[clipId]),
    ]);
    return {
      clipId,
      start: shot.start,
      end: shot.end,
      sourceText: shot.rawText,
      visualDirection: shot.visualDirection,
      cameraDirection: shot.cameraDirection,
      audioCue: shot.audioCue,
      onScreenText: shot.onScreenText,
      selectedCharacterIds,
      selectedReferenceIds,
    };
  });
}

export function migrateLegacyDirectorAssets(input: LegacyMigrationInput): ScriptLockedDirectorSessionV1 {
  return {
    version: 1,
    sourceVision: "",
    // Deliberately never migrate legacy plan.shots[].prompt. Script-Locked text must be recompiled.
    compiledByClip: {},
    approvedCharacterIds: uniqueStrings(input.approvedCharacterIds),
    characterSelections: sanitizeSelections(input.characterSelections),
    shotApprovals: sanitizeApprovals(input.shotApprovals),
    sceneApprovals: sanitizeApprovals(input.sceneApprovals),
    sectionApprovals: sanitizeApprovals(input.sectionApprovals),
  };
}
