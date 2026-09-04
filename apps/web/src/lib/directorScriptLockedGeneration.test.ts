import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgnesGenerationInstruction,
  buildScriptLockedImageReferenceUrls,
  prepareScriptLockedVideoGeneration,
} from "./directorScriptLockedGeneration.js";


test("compiled shot stays first and legacy filler is absent", () => {
  const prompt = buildAgnesGenerationInstruction({
    agnesPrompt: "Character 1 walks from the white piano to the window while the camera tracks right.",
    continuityConstraints: ["Match Character 1 exactly: same complexion and red suit."],
  });

  assert.match(prompt, /^Character 1 walks/);
  assert.match(prompt, /same complexion and red suit/i);
  assert.doesNotMatch(prompt, /cinematic scene board|visual style|color palette|masterful composition/i);
});


test("image reference order is target then selected characters then continuity anchors", () => {
  assert.deepEqual(buildScriptLockedImageReferenceUrls({
    currentImageUrl: "/current.png",
    selectedCharacterUrls: ["/char-a.png", "/char-b.png"],
    sameCharacterAnchorUrl: "/same-anchor.png",
    projectAnchorUrl: "/project-anchor.png",
  }), [
    "/current.png",
    "/char-a.png",
    "/char-b.png",
    "/same-anchor.png",
    "/project-anchor.png",
  ]);

  assert.deepEqual(buildScriptLockedImageReferenceUrls({
    currentImageUrl: "/current.png",
    selectedCharacterUrls: ["/current.png", "/char-a.png"],
    sameCharacterAnchorUrl: "/char-a.png",
    projectAnchorUrl: "/project-anchor.png",
  }), ["/current.png", "/char-a.png", "/project-anchor.png"]);
});


test("character-selected video requires the approved current shot image and uses it as the single seed", () => {
  const blocked = prepareScriptLockedVideoGeneration({
    clipId: "vision-shot-1",
    start: 12,
    end: 18,
    sectionLabel: "Shot 1",
    agnesPrompt: "Character 1 walks to the window.",
    continuityConstraints: ["Keep the red suit unchanged."],
    selectedCharacterIds: ["char-1"],
    approvedShotImage: { url: "/shot.png", approved: false },
  });
  assert.equal(blocked.ok, false);

  const ready = prepareScriptLockedVideoGeneration({
    clipId: "vision-shot-1",
    start: 12,
    end: 18,
    sectionLabel: "Shot 1",
    agnesPrompt: "Character 1 walks to the window.",
    continuityConstraints: ["Keep the red suit unchanged."],
    selectedCharacterIds: ["char-1"],
    approvedShotImage: { url: "/shot.png", approved: true },
  });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  assert.equal(ready.input.seedImageUrl, "/shot.png");
  assert.equal(ready.input.source, "imageToVideo");
  assert.match(ready.input.prompt, /^Character 1 walks/);
});
