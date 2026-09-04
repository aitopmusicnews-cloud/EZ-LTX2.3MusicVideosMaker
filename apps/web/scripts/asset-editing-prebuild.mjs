import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const buildPath = resolve(scriptsDir, "build.mjs");
let source = await readFile(buildPath, "utf8");

const importAnchor = 'import { patchDirectorMultiCharacter } from "./director-multichar.patch.mjs";';
const editingImport = 'import { patchDirectorAssetEditing } from "./director-asset-editing.patch.mjs";';
if (!source.includes(editingImport)) {
  if (!source.includes(importAnchor)) throw new Error("Could not find Director multi-character build import.");
  source = source.replace(importAnchor, `${importAnchor}\n${editingImport}`);
}

const identityImport = 'import { patchDirectorCharacterIdentity } from "./director-character-identity.patch.mjs";';
const continuityImport = 'import { patchDirectorStrictContinuity } from "./director-strict-continuity.patch.mjs";';
if (!source.includes(continuityImport)) {
  if (!source.includes(identityImport)) throw new Error("Could not find Director character-identity build import.");
  source = source.replace(identityImport, `${identityImport}\n${continuityImport}`);
}

const scriptLockedImport = 'import { patchEditorScriptLockedMount, patchLegacyDirectorLauncherOwnership } from "./scriptlocked-director-launcher.patch.mjs";';
if (!source.includes(scriptLockedImport)) {
  if (!source.includes(continuityImport)) throw new Error("Could not find Director strict-continuity build import for Script-Locked launcher wiring.");
  source = source.replace(continuityImport, `${continuityImport}\n${scriptLockedImport}`);
}

const agentPathAnchor = 'const agentPath = resolve(webRoot, "src/components/LtxDirectorAgent.tsx");';
const editorPathLine = 'const editorPath = resolve(webRoot, "src/routes/Editor.tsx");';
if (!source.includes(editorPathLine)) {
  if (!source.includes(agentPathAnchor)) throw new Error("Could not find Director agent path for Script-Locked editor wiring.");
  source = source.replace(agentPathAnchor, `${agentPathAnchor}\n${editorPathLine}`);
}

const originalAgentAnchor = 'const originalAgent = await readFile(agentPath, "utf8");';
const originalEditorLine = 'const originalEditor = await readFile(editorPath, "utf8");';
if (!source.includes(originalEditorLine)) {
  if (!source.includes(originalAgentAnchor)) throw new Error("Could not find Director source read for Script-Locked editor wiring.");
  source = source.replace(originalAgentAnchor, `${originalAgentAnchor}\n${originalEditorLine}`);
}

const callAnchor = "patchedAgent = patchDirectorMultiCharacter(patchedAgent, replaceRequired);";
const editingCall = "patchedAgent = patchDirectorAssetEditing(patchedAgent, replaceRequired);";
if (!source.includes(editingCall)) {
  if (!source.includes(callAnchor)) throw new Error("Could not find Director multi-character build call.");
  source = source.replace(callAnchor, `${callAnchor}\n${editingCall}`);
}

const identityCall = "patchedAgent = patchDirectorCharacterIdentity(patchedAgent, replaceRequired);";
const continuityCall = "patchedAgent = patchDirectorStrictContinuity(patchedAgent, replaceRequired);";
if (!source.includes(continuityCall)) {
  if (!source.includes(identityCall)) throw new Error("Could not find Director character-identity build call.");
  source = source.replace(identityCall, `${identityCall}\n${continuityCall}`);
}

const scriptLockedOwnershipCall = "patchedAgent = patchLegacyDirectorLauncherOwnership(patchedAgent, replaceRequired);";
if (!source.includes(scriptLockedOwnershipCall)) {
  if (!source.includes(continuityCall)) throw new Error("Could not find Director strict-continuity build call for Script-Locked launcher ownership.");
  source = source.replace(continuityCall, `${continuityCall}\n${scriptLockedOwnershipCall}`);
}

const patchedPromoAnchor = "const patchedPromo = patchPromoLeftRailLauncher(originalPromo, replaceRequired);";
const patchedEditorLine = "const patchedEditor = patchEditorScriptLockedMount(originalEditor, replaceRequired);";
if (!source.includes(patchedEditorLine)) {
  if (!source.includes(patchedPromoAnchor)) throw new Error("Could not find final web patch declaration for Script-Locked editor mount.");
  source = source.replace(patchedPromoAnchor, `${patchedPromoAnchor}\n${patchedEditorLine}`);
}

const agentWriteAnchor = '  await writeFile(agentPath, patchedAgent, "utf8");';
const editorWriteLine = '  await writeFile(editorPath, patchedEditor, "utf8");';
if (!source.includes(editorWriteLine)) {
  if (!source.includes(agentWriteAnchor)) throw new Error("Could not find Director source write for Script-Locked editor mount.");
  source = source.replace(agentWriteAnchor, `${agentWriteAnchor}\n${editorWriteLine}`);
}

const agentRestoreAnchor = '  await writeFile(agentPath, originalAgent, "utf8");';
const editorRestoreLine = '  await writeFile(editorPath, originalEditor, "utf8");';
if (!source.includes(editorRestoreLine)) {
  if (!source.includes(agentRestoreAnchor)) throw new Error("Could not find Director source restore for Script-Locked editor mount.");
  source = source.replace(agentRestoreAnchor, `${agentRestoreAnchor}\n${editorRestoreLine}`);
}

const logAnchor = '  console.log("[web build] Enabled Director session v4 multi-character approvals and legacy migration.");';
const editingLog = '  console.log("[web build] Enabled target-locked inline asset editing with explicit provider actions.");';
if (!source.includes(editingLog) && source.includes(logAnchor)) source = source.replace(logAnchor, `${logAnchor}\n${editingLog}`);

const identityLog = '  console.log("[web build] Bound selected character identities to their matching reference images.");';
const continuityLog = '  console.log("[web build] Hardwired strict continuity for skin tone, wardrobe, props, equipment, and recurring visual details.");';
if (!source.includes(continuityLog) && source.includes(identityLog)) source = source.replace(identityLog, `${identityLog}\n${continuityLog}`);

const scriptLockedLog = '  console.log("[web build] Mounted Script-Locked Director with Assisted Director rollback ownership.");';
if (!source.includes(scriptLockedLog) && source.includes(continuityLog)) source = source.replace(continuityLog, `${continuityLog}\n${scriptLockedLog}`);

if (!source.includes(editingImport) || !source.includes(editingCall)) throw new Error("Director asset-editing build injection did not apply.");
if (!source.includes(continuityImport) || !source.includes(continuityCall)) throw new Error("Director strict-continuity build injection did not apply.");
if (!source.includes(scriptLockedImport) || !source.includes(scriptLockedOwnershipCall) || !source.includes(patchedEditorLine) || !source.includes(originalEditorLine)) throw new Error("Script-Locked Director build injection did not apply.");
await writeFile(buildPath, source, "utf8");
console.log("[web prebuild] Enabled Director inline asset editing, strict continuity, and Script-Locked launcher ownership.");
