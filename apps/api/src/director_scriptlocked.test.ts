import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const fixture = JSON.parse(
  await readFile("services/videodb-director/tests/fixtures/scriptlocked_4shot.json", "utf8"),
) as ScriptLockedCompileRequest;

function fixtureResponse() {
  return {
    compiler: "videodb-scriptlocked-agnes-v1" as const,
    shots: fixture.shots.map((shot) => ({
      clipId: shot.clipId,
      start: shot.start,
      end: shot.end,
      sourceText: shot.sourceText,
      agnesPrompt: [shot.visualDirection, shot.cameraDirection, shot.onScreenText ? `On-screen text: ${shot.onScreenText}` : ""].filter(Boolean).join(" "),
      selectedCharacterIds: [...shot.selectedCharacterIds],
      selectedReferenceIds: [...shot.selectedReferenceIds],
      continuityConstraints: [],
      compilerNotes: [],
    })),
  };
}


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


test("realistic four-shot fixture preserves IDs timing source and separate character selections", () => {
  const response = fixtureResponse();
  const validated = validateCompileResponse(fixture, response);
  assert.equal(validated.shots.length, 4);
  assert.equal(validated.shots[2]!.start, 10);
  assert.equal(validated.shots[2]!.end, 16);
  assert.match(validated.shots[2]!.agnesPrompt, /STAY WITH ME/);
  assert.deepEqual(validated.shots[0]!.selectedCharacterIds, ["char-maya"]);
  assert.deepEqual(validated.shots[1]!.selectedCharacterIds, ["char-jules"]);
  assert.deepEqual(validated.shots[3]!.selectedCharacterIds, ["char-maya", "char-jules"]);
});


test("four-shot contract rejects renamed IDs changed source and swapped character references", () => {
  const renamed = fixtureResponse();
  renamed.shots[0] = { ...renamed.shots[0]!, clipId: "vision-shot-renamed" };
  assert.throws(() => validateCompileResponse(fixture, renamed), /unknown clipId|exact source/i);

  const changedSource = fixtureResponse();
  changedSource.shots[1] = { ...changedSource.shots[1]!, sourceText: "Different source text" };
  assert.throws(() => validateCompileResponse(fixture, changedSource), /exact source/i);

  const swappedCharacter = fixtureResponse();
  swappedCharacter.shots[0] = { ...swappedCharacter.shots[0]!, selectedCharacterIds: ["char-jules"] };
  assert.throws(() => validateCompileResponse(fixture, swappedCharacter), /changed selected characters/i);
});
