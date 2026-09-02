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

const callAnchor = "patchedAgent = patchDirectorMultiCharacter(patchedAgent, replaceRequired);";
const editingCall = "patchedAgent = patchDirectorAssetEditing(patchedAgent, replaceRequired);";
if (!source.includes(editingCall)) {
  if (!source.includes(callAnchor)) throw new Error("Could not find Director multi-character build call.");
  source = source.replace(callAnchor, `${callAnchor}\n${editingCall}`);
}

const logAnchor = '  console.log("[web build] Enabled Director session v4 multi-character approvals and legacy migration.");';
const editingLog = '  console.log("[web build] Enabled target-locked inline asset editing with explicit provider actions.");';
if (!source.includes(editingLog) && source.includes(logAnchor)) source = source.replace(logAnchor, `${logAnchor}\n${editingLog}`);

if (!source.includes(editingImport) || !source.includes(editingCall)) throw new Error("Director asset-editing build injection did not apply.");
await writeFile(buildPath, source, "utf8");
console.log("[web prebuild] Enabled Director inline asset editing.");
