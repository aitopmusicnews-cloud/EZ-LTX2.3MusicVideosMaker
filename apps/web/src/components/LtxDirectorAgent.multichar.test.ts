import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchOptionalCharacterConditioning } from "../../scripts/optional-character-conditioning.patch.mjs";
import { patchDirectorChat } from "../../scripts/director-chat-patch.mjs";
import { patchDirectorLeftRailLauncher } from "../../scripts/left-rail-tools.patch.mjs";
import { patchDirectorMultiCharacter } from "../../scripts/director-multichar.patch.mjs";

const source = await readFile(new URL("./LtxDirectorAgent.tsx", import.meta.url), "utf8");
const replaceRequired = (input: string, from: string, to: string, label: string) => {
  assert.ok(input.includes(from), `missing patch anchor: ${label}`);
  return input.replace(from, to);
};

let patched = patchOptionalCharacterConditioning(source, replaceRequired);
patched = patchDirectorChat(patched, replaceRequired);
patched = patchDirectorLeftRailLauncher(patched, replaceRequired);
patched = patchDirectorMultiCharacter(patched, replaceRequired);

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
  assert.match(patched, /resolveCharacterReferenceUrls/);
});

test("character-required video generation uses only an approved shot image as the Agnes seed", () => {
  assert.match(patched, /chooseApprovedShotSeed\(session\.shotApprovals\[clipId\]\)/);
  assert.match(patched, /needs an approved shot image before video generation/);
  assert.match(patched, /seedImageUrl: approvedShotSeed/);
});
