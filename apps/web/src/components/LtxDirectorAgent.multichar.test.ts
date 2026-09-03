import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchOptionalCharacterConditioning } from "../../scripts/optional-character-conditioning.patch.mjs";
import { patchDirectorChat } from "../../scripts/director-chat-patch.mjs";
import { patchDirectorLeftRailLauncher } from "../../scripts/left-rail-tools.patch.mjs";
import { patchDirectorMultiCharacter } from "../../scripts/director-multichar.patch.mjs";
import { patchDirectorAssetEditing } from "../../scripts/director-asset-editing.patch.mjs";
import { patchDirectorCharacterIdentity } from "../../scripts/director-character-identity.patch.mjs";
import { patchDirectorStrictContinuity } from "../../scripts/director-strict-continuity.patch.mjs";

const source = await readFile(new URL("./LtxDirectorAgent.tsx", import.meta.url), "utf8");
const replaceRequired = (input: string, from: string, to: string, label: string) => {
  assert.ok(input.includes(from), `missing patch anchor: ${label}`);
  return input.replace(from, to);
};

let patched = patchOptionalCharacterConditioning(source, replaceRequired);
patched = patchDirectorChat(patched, replaceRequired);
patched = patchDirectorLeftRailLauncher(patched, replaceRequired);
patched = patchDirectorMultiCharacter(patched, replaceRequired);
patched = patchDirectorAssetEditing(patched, replaceRequired);
patched = patchDirectorCharacterIdentity(patched, replaceRequired);
patched = patchDirectorStrictContinuity(patched, replaceRequired);

test("the shipped active Director uses session v4 multi-character state", () => {
  assert.match(patched, /const SESSION_VERSION = 4/);
  assert.match(patched, /approvedCharacterIds/);
  assert.match(patched, /characterSelections/);
  assert.match(patched, /pendingAssetEdits/);
  assert.match(patched, /migrateDirectorCharacterState/);
});

test("the final Director keeps Vision-first planning intact", () => {
  assert.match(patched, /buildVisionTimelineClips/);
  assert.match(patched, /Vision override detected:/);
});

test("multi-character approval replaces the legacy production gate", () => {
  assert.doesNotMatch(patched, /characterConditioningRequired && !session\.characterApproved/);
  assert.match(patched, /approvedCharacterIds\.length/);
});

test("pending asset edits use target type plus clip ID so scene shot and clip edits cannot collide", () => {
  assert.match(patched, /assetEditKey/);
  assert.match(patched, /\$\{type\}:\$\{clipId\}/);
});

test("approval images accept multiple reference URLs", () => {
  assert.match(patched, /generateApprovalImage\(prompt: string, referenceUrls: string\[\] = \[\]\)/);
  assert.match(patched, /buildApprovalReferenceImages/);
  assert.match(patched, /resolveCharacterIdentities/);
});

test("multi-character image prompts explicitly bind each identity to its reference image", () => {
  assert.match(patched, /buildCharacterIdentityInstruction/);
  assert.match(patched, /selectedCharactersForShot/);
  assert.match(patched, /sceneIdentityInstruction/);
  assert.match(patched, /shotIdentityInstruction/);
});

test("prepared image edits preserve the same character identity bindings", () => {
  assert.match(patched, /preparedCharacters/);
  assert.match(patched, /preparedIdentityInstruction/);
  assert.match(patched, /pending\.prompt.*preparedIdentityInstruction|preparedIdentityInstruction.*pending\.prompt/s);
});

test("the project-character alias is hidden when a named character already uses the same image", () => {
  assert.match(patched, /!options\.some\(\(option\) => option\.url === characterImageUrl\)/);
});

test("character-required video generation uses only an approved shot image as the Agnes seed", () => {
  assert.match(patched, /chooseApprovedShotSeed\(session\.shotApprovals\[clipId\]\)/);
  assert.match(patched, /needs an approved shot image before video generation/);
  assert.match(patched, /seedImageUrl: approvedShotSeed/);
});

test("scene and shot images carry a prior approved continuity anchor and strict lock", () => {
  assert.match(patched, /findPriorApprovedContinuityAnchor/);
  assert.match(patched, /buildStrictContinuityInstruction/);
  assert.match(patched, /sceneContinuityAnchor/);
  assert.match(patched, /shotContinuityAnchor/);
  assert.match(patched, /sceneStrictContinuityInstruction/);
  assert.match(patched, /shotStrictContinuityInstruction/);
});

test("project-wide props and equipment use the nearest approved project anchor even when characters change", () => {
  assert.match(patched, /findPriorApprovedProjectAnchor/);
  assert.match(patched, /projectContinuityAnchorForShot/);
  assert.match(patched, /sceneProjectAnchor/);
  assert.match(patched, /shotProjectAnchor/);
  assert.match(patched, /projectAnchorUrl/);
});

test("prepared image edits cannot bypass strict continuity", () => {
  assert.match(patched, /preparedContinuityAnchor/);
  assert.match(patched, /preparedProjectAnchor/);
  assert.match(patched, /preparedStrictContinuityInstruction/);
  assert.match(patched, /pending\.prompt.*preparedStrictContinuityInstruction|preparedStrictContinuityInstruction.*pending\.prompt/s);
});

test("Agnes section generation hard-locks the approved shot seed across every frame and segment", () => {
  assert.match(patched, /buildStrictVideoContinuityInstruction/);
  assert.match(patched, /videoContinuityInstruction/);
  assert.match(patched, /prompt:.*videoContinuityInstruction|videoContinuityInstruction.*prompt:/s);
});

test("Director visibly reports that strict continuity is always active", () => {
  assert.match(patched, /Strict continuity lock active/i);
  assert.match(patched, /skin tone.*wardrobe.*props.*equipment/is);
});
