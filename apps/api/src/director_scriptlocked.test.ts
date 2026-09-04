import assert from "node:assert/strict";
import test from "node:test";

import { type ScriptLockedCompileRequest, validateCompileResponse } from "./director_scriptlocked_contract.js";
import { buildScriptPreservingFallback } from "./director_scriptlocked_fallback.js";

const request: ScriptLockedCompileRequest = {
  projectId: "proj-1",
  visionMode: "structured",
  shots: [{
    clipId: "vision-shot-1",
    start: 12,
    end: 18,
    sourceText: "Character 1 walks to the window. Camera tracks right.",
    visualDirection: "Character 1 walks to the window.",
    cameraDirection: "Camera tracks right.",
    audioCue: "",
    onScreenText: "",
    selectedCharacterIds: ["char-1"],
    selectedReferenceIds: ["char-1"],
  }],
  references: [{
    id: "char-1",
    kind: "character",
    name: "Character 1",
    description: "Black woman in red suit",
  }],
  mustInclude: "",
  avoid: "",
};


test("rejects changed end time", () => {
  const source = request.shots[0]!;
  const response = {
    compiler: "videodb-scriptlocked-agnes-v1" as const,
    shots: [{
      clipId: source.clipId,
      start: source.start,
      end: 19,
      sourceText: source.sourceText,
      agnesPrompt: "Character 1 walks to the window.",
      selectedCharacterIds: [...source.selectedCharacterIds],
      selectedReferenceIds: [...source.selectedReferenceIds],
      continuityConstraints: [],
      compilerNotes: [],
    }],
  };
  assert.throws(() => validateCompileResponse(request, response), /exact source/i);
});


test("literal fallback has no generic filler", () => {
  const prompt = buildScriptPreservingFallback(request).shots[0]!.agnesPrompt;
  assert.match(prompt, /walks to the window/i);
  assert.match(prompt, /camera tracks right/i);
  assert.doesNotMatch(prompt, /cinematic|masterful|neon|dramatic lighting/i);
});
