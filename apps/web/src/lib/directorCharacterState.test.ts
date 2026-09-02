import test from "node:test";
import assert from "node:assert/strict";
import {
  migrateDirectorCharacterState,
  sanitizeCharacterSelections,
  selectionForClip,
  setClipCharacterSelection,
  toggleApprovedCharacter,
} from "./directorCharacterState.js";

test("multiple characters can be approved independently", () => {
  let ids = toggleApprovedCharacter([], "char-a");
  ids = toggleApprovedCharacter(ids, "char-b");
  assert.deepEqual(ids, ["char-a", "char-b"]);
  ids = toggleApprovedCharacter(ids, "char-a");
  assert.deepEqual(ids, ["char-b"]);
});

test("unapproving a character removes it from every clip selection", () => {
  const next = sanitizeCharacterSelections(
    { "clip-1": ["char-a", "char-b"], "clip-2": ["char-a"] },
    ["char-b"],
  );
  assert.deepEqual(next, { "clip-1": ["char-b"], "clip-2": [] });
});

test("one clip can select two approved characters", () => {
  const next = setClipCharacterSelection({}, "clip-1", ["char-a", "char-b"], ["char-a", "char-b"]);
  assert.deepEqual(next["clip-1"], ["char-a", "char-b"]);
});

test("legacy single-character approval migrates", () => {
  const state = migrateDirectorCharacterState({
    legacyCharacterApproved: true,
    legacyCharacterReferenceId: "char-a",
    validCharacterIds: ["char-a", "char-b"],
  });
  assert.deepEqual(state.approvedCharacterIds, ["char-a"]);
});

test("legacy conditioning ID becomes the default clip selection", () => {
  assert.deepEqual(selectionForClip({}, "clip-1", "char-a"), ["char-a"]);
});

test("migration sanitizes invalid and duplicate IDs without mutating input", () => {
  const approvedCharacterIds = ["char-a", "missing", "char-a"];
  const characterSelections = { "clip-1": ["char-a", "missing", "char-a"] };
  const state = migrateDirectorCharacterState({
    approvedCharacterIds,
    characterSelections,
    validCharacterIds: ["char-a", "char-b"],
  });
  assert.deepEqual(state, {
    approvedCharacterIds: ["char-a"],
    characterSelections: { "clip-1": ["char-a"] },
  });
  assert.deepEqual(approvedCharacterIds, ["char-a", "missing", "char-a"]);
  assert.deepEqual(characterSelections, { "clip-1": ["char-a", "missing", "char-a"] });
});
