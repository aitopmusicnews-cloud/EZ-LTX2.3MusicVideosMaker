import { chooseApprovedShotSeed } from "./directorCharacterMedia.js";

export type ScriptLockedVideoGenerationInput = {
  clipId: string;
  source: "textToVideo" | "imageToVideo";
  seedImageUrl: string;
  prompt: string;
  duration: number;
  sectionLabel: string;
  energy: number;
  model: "agnes-video-v2.0";
};

export type PreparedScriptLockedVideoGeneration =
  | { ok: true; input: ScriptLockedVideoGenerationInput }
  | { ok: false; reason: string };

function uniqueUrls(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

export function buildAgnesGenerationInstruction(input: {
  agnesPrompt: string;
  continuityConstraints: string[];
}): string {
  return [
    input.agnesPrompt.trim(),
    ...input.continuityConstraints.map((item) => item.trim()).filter(Boolean),
  ].filter(Boolean).join(" ");
}

export function buildScriptLockedImageReferenceUrls(input: {
  currentImageUrl?: string;
  selectedCharacterUrls: string[];
  sameCharacterAnchorUrl?: string;
  projectAnchorUrl?: string;
}): string[] {
  return uniqueUrls([
    input.currentImageUrl,
    ...input.selectedCharacterUrls,
    input.sameCharacterAnchorUrl,
    input.projectAnchorUrl,
  ]);
}

export function prepareScriptLockedVideoGeneration(input: {
  clipId: string;
  start: number;
  end: number;
  sectionLabel: string;
  agnesPrompt: string;
  continuityConstraints: string[];
  selectedCharacterIds: string[];
  approvedShotImage?: { url: string; approved: boolean };
}): PreparedScriptLockedVideoGeneration {
  const seedImageUrl = chooseApprovedShotSeed(input.approvedShotImage);
  if (input.selectedCharacterIds.length > 0 && !seedImageUrl) {
    return {
      ok: false,
      reason: "Character-selected Script-Locked shots require an approved current shot image before Agnes video generation.",
    };
  }

  const prompt = buildAgnesGenerationInstruction({
    agnesPrompt: input.agnesPrompt,
    continuityConstraints: input.continuityConstraints,
  });
  if (!prompt) return { ok: false, reason: "Compile an Agnes instruction before generation." };

  return {
    ok: true,
    input: {
      clipId: input.clipId,
      source: seedImageUrl ? "imageToVideo" : "textToVideo",
      seedImageUrl: seedImageUrl ?? "",
      prompt,
      duration: Math.max(0, input.end - input.start),
      sectionLabel: input.sectionLabel,
      energy: 0.65,
      model: "agnes-video-v2.0",
    },
  };
}
