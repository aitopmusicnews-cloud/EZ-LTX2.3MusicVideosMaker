import type {
  ScriptLockedCompileRequest,
  ScriptLockedCompileResponse,
  ScriptLockedReference,
  ScriptLockedShot,
} from "./director_scriptlocked_contract.js";

function continuityConstraints(shot: ScriptLockedShot, references: ScriptLockedReference[]): string[] {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const result: string[] = [];
  for (const characterId of shot.selectedCharacterIds) {
    const reference = byId.get(characterId);
    if (!reference || reference.kind !== "character") continue;
    result.push(`Match ${reference.name} / ${reference.id} exactly: same identity, skin tone/complexion, face, hair, wardrobe, jewelry, and accessories unless this shot explicitly changes them.`);
  }
  const characterIds = new Set(shot.selectedCharacterIds);
  for (const referenceId of shot.selectedReferenceIds) {
    if (characterIds.has(referenceId)) continue;
    const reference = byId.get(referenceId);
    if (!reference?.description.trim()) continue;
    result.push(`Preserve the approved continuity facts from ${reference.name} / ${reference.id}: ${reference.description.trim()}.`);
  }
  return result;
}

export function buildScriptPreservingFallback(req: ScriptLockedCompileRequest): ScriptLockedCompileResponse {
  return {
    compiler: "node-script-preserving-fallback-v1",
    shots: req.shots.map((shot) => ({
      clipId: shot.clipId,
      start: shot.start,
      end: shot.end,
      sourceText: shot.sourceText,
      agnesPrompt: [
        shot.visualDirection.trim() || shot.sourceText.trim(),
        shot.cameraDirection.trim(),
        shot.onScreenText.trim() ? `On-screen text: ${shot.onScreenText.trim()}` : "",
        shot.audioCue.trim() ? `Audio cue: ${shot.audioCue.trim()}` : "",
      ].filter(Boolean).join(" "),
      selectedCharacterIds: [...shot.selectedCharacterIds],
      selectedReferenceIds: [...shot.selectedReferenceIds],
      continuityConstraints: continuityConstraints(shot, req.references),
      compilerNotes: ["Reasoning service unavailable; literal script-preserving fallback used."],
    })),
  };
}
