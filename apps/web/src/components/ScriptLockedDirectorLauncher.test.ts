import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const patch = await readFile(new URL("../../scripts/scriptlocked-director-launcher.patch.mjs", import.meta.url), "utf8");
const prebuild = await readFile(new URL("../../scripts/asset-editing-prebuild.mjs", import.meta.url), "utf8");


test("Script-Locked feature flag gives the main Director event to the new component", () => {
  assert.match(patch, /VITE_SCRIPTLOCKED_DIRECTOR_ENABLED/);
  assert.match(patch, /mvs-open-assisted-director/);
  assert.match(patch, /mvs-open-ltx-director/);
});


test("launcher patch mounts the Script-Locked component without deleting Assisted Director", () => {
  assert.match(patch, /ScriptLockedDirectorAgent/);
  assert.match(patch, /patchLegacyDirectorLauncherOwnership/);
  assert.match(patch, /patchEditorScriptLockedMount/);
});


test("web prebuild injects launcher ownership and editor mount into the production build", () => {
  assert.match(prebuild, /scriptlocked-director-launcher\.patch\.mjs/);
  assert.match(prebuild, /patchLegacyDirectorLauncherOwnership/);
  assert.match(prebuild, /patchEditorScriptLockedMount/);
  assert.match(prebuild, /originalEditor/);
});
