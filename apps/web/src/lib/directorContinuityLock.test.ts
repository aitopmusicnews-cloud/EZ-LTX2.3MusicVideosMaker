import test from "node:test";
import assert from "node:assert/strict";
import * as continuity from "./directorContinuityLock.js";

const { buildStrictContinuityInstruction, buildStrictVideoContinuityInstruction, findPriorApprovedContinuityAnchor, findPriorApprovedProjectAnchor } = continuity as any;

test("same character reuses the nearest prior approved visual instead of a different character", () => {
  assert.equal(typeof findPriorApprovedContinuityAnchor, "function", "findPriorApprovedContinuityAnchor must exist");
  const anchor = findPriorApprovedContinuityAnchor({
    currentClipId: "clip-c",
    shots: [{ clipId: "clip-a" }, { clipId: "clip-b" }, { clipId: "clip-c" }],
    shotApprovals: {
      "clip-a": { url: "/character-a-approved.png", approved: true },
      "clip-b": { url: "/character-b-approved.png", approved: true },
    },
    sceneApprovals: {},
    characterSelections: {
      "clip-a": ["char-a"],
      "clip-b": ["char-b"],
      "clip-c": ["char-a"],
    },
  });
  assert.deepEqual(anchor, { url: "/character-a-approved.png", clipId: "clip-a", kind: "shot" });
});

test("nearest project anchor carries props and equipment even when the character changes", () => {
  assert.equal(typeof findPriorApprovedProjectAnchor, "function", "findPriorApprovedProjectAnchor must exist");
  const anchor = findPriorApprovedProjectAnchor({
    currentClipId: "clip-c",
    shots: [{ clipId: "clip-a" }, { clipId: "clip-b" }, { clipId: "clip-c" }],
    shotApprovals: {
      "clip-a": { url: "/older.png", approved: true },
      "clip-b": { url: "/nearest-different-character.png", approved: true },
    },
    sceneApprovals: {},
  });
  assert.deepEqual(anchor, { url: "/nearest-different-character.png", clipId: "clip-b", kind: "shot" });
});

test("unapproved visuals can never become continuity anchors", () => {
  assert.equal(typeof findPriorApprovedContinuityAnchor, "function", "findPriorApprovedContinuityAnchor must exist");
  const anchor = findPriorApprovedContinuityAnchor({
    currentClipId: "clip-b",
    shots: [{ clipId: "clip-a" }, { clipId: "clip-b" }],
    shotApprovals: { "clip-a": { url: "/draft.png", approved: false } },
    sceneApprovals: { "clip-a": { url: "/approved-scene.png", approved: true } },
    characterSelections: { "clip-a": ["char-a"], "clip-b": ["char-a"] },
  });
  assert.deepEqual(anchor, { url: "/approved-scene.png", clipId: "clip-a", kind: "scene" });
});

test("strict still-image continuity locks skin tone wardrobe props and equipment", () => {
  assert.equal(typeof buildStrictContinuityInstruction, "function", "buildStrictContinuityInstruction must exist");
  const instruction = buildStrictContinuityInstruction({
    identities: [{ id: "char-a", name: "Lead", url: "/lead.png" }],
    continuityAnchorUrl: "/approved-prior-character-shot.png",
    projectAnchorUrl: "/approved-prior-project-shot.png",
    referenceUrls: ["/lead.png", "/approved-prior-character-shot.png", "/approved-prior-project-shot.png"],
  });
  assert.match(instruction, /skin tone|complexion/i);
  assert.match(instruction, /wardrobe/i);
  assert.match(instruction, /props/i);
  assert.match(instruction, /equipment/i);
  assert.match(instruction, /Reference image 2.*character continuity anchor/i);
  assert.match(instruction, /Reference image 3.*project continuity anchor/i);
  assert.match(instruction, /project continuity anchor.*do not copy.*people|do not copy.*people.*project continuity anchor/is);
  assert.match(instruction, /unless.*current script.*explicit/i);
});

test("strict video continuity keeps the approved seed consistent across every frame and technical segment", () => {
  assert.equal(typeof buildStrictVideoContinuityInstruction, "function", "buildStrictVideoContinuityInstruction must exist");
  const instruction = buildStrictVideoContinuityInstruction([{ id: "char-a", name: "Lead", url: "/lead.png" }]);
  assert.match(instruction, /approved shot image.*seed/i);
  assert.match(instruction, /every frame/i);
  assert.match(instruction, /technical segment/i);
  assert.match(instruction, /skin tone|complexion/i);
  assert.match(instruction, /wardrobe/i);
  assert.match(instruction, /props/i);
  assert.match(instruction, /equipment/i);
  assert.match(instruction, /unless.*current script.*explicit/i);
});
