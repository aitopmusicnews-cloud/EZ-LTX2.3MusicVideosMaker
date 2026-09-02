import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchOptionalCharacterConditioning } from "../../scripts/optional-character-conditioning.patch.mjs";
import { patchDirectorChat } from "../../scripts/director-chat-patch.mjs";
import { patchDirectorLeftRailLauncher } from "../../scripts/left-rail-tools.patch.mjs";
import { patchDirectorMultiCharacter } from "../../scripts/director-multichar.patch.mjs";
import { patchDirectorAssetEditing } from "../../scripts/director-asset-editing.patch.mjs";

const assetsSource = await readFile(new URL("./DirectorAssetsPanel.tsx", import.meta.url), "utf8");
const sectionSource = await readFile(new URL("./DirectorSectionReview.tsx", import.meta.url), "utf8");
const agentSource = await readFile(new URL("./LtxDirectorAgent.tsx", import.meta.url), "utf8");

const replaceRequired = (input: string, from: string, to: string, label: string) => {
  assert.ok(input.includes(from), `missing patch anchor: ${label}`);
  return input.replace(from, to);
};

let patchedAgent = patchOptionalCharacterConditioning(agentSource, replaceRequired);
patchedAgent = patchDirectorChat(patchedAgent, replaceRequired);
patchedAgent = patchDirectorLeftRailLauncher(patchedAgent, replaceRequired);
patchedAgent = patchDirectorMultiCharacter(patchedAgent, replaceRequired);
patchedAgent = patchDirectorAssetEditing(patchedAgent, replaceRequired);

test("reusable generated scene and shot image cards expose inline chat and character pickers", () => {
  assert.match(assetsSource, /AssetEditChat/);
  assert.match(assetsSource, /DirectorCharacterPicker/);
  assert.match(assetsSource, /targetType:\s*"scene_image"/);
  assert.match(assetsSource, /targetType:\s*"shot_image"/);
});

test("production clip cards expose target-locked inline chat and character pickers", () => {
  assert.match(sectionSource, /AssetEditChat/);
  assert.match(sectionSource, /DirectorCharacterPicker/);
  assert.match(sectionSource, /type:\s*"clip"/);
  assert.doesNotMatch(sectionSource, />Chat changes</);
});

test("main Director scene approval cards expose inline edit chat and character selection beneath the image", () => {
  assert.match(patchedAgent, /sceneApproval\?\.url[\s\S]{0,4200}DirectorCharacterPicker[\s\S]{0,2200}AssetEditChat[\s\S]{0,900}type:\s*"scene_image"/);
});

test("main Director shot approval cards expose inline edit chat and character selection beneath the image", () => {
  assert.match(patchedAgent, /shotApproval\?\.url[\s\S]{0,4800}DirectorCharacterPicker[\s\S]{0,2200}AssetEditChat[\s\S]{0,900}type:\s*"shot_image"/);
});

test("Director chat prepares regeneration and image edits without spending provider credits automatically", () => {
  assert.doesNotMatch(patchedAgent, /if \(action\.regenerate\)[\s\S]{0,800}generateSectionPreview\(action\.clipId\)/);
  assert.doesNotMatch(patchedAgent, /action\.type === "edit_scene_image"[\s\S]{0,800}await generateSceneVisual/);
  assert.doesNotMatch(patchedAgent, /action\.type === "edit_shot_image"[\s\S]{0,800}await generateShotVisual/);
  assert.match(patchedAgent, /pendingAssetEdits/);
  assert.match(patchedAgent, /assetEditKey/);
});

test("prepared image edits and clip regeneration require explicit UI actions", () => {
  assert.match(patchedAgent, /Generate edited image/);
  assert.match(sectionSource, /prepared|regeneration/i);
  assert.match(sectionSource, /onGenerate\(shot\.clipId\)/);
});
