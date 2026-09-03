import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchDirectorStatus } from "./director-status-patch.mjs";
import { patchDirectorEditing } from "./director-edit-patch.mjs";
import { patchDirectorAgentRuntime, patchDirectorReferenceChat } from "./director-agent-runtime-patch.mjs";
import { patchOptionalCharacterConditioning } from "./optional-character-conditioning.patch.mjs";
import { patchDirectorChat } from "./director-chat-patch.mjs";
import { patchDirectorMultiCharacter } from "./director-multichar.patch.mjs";
import { patchDirectorCharacterIdentity } from "./director-character-identity.patch.mjs";
import { patchAnalyzerDefinedClips, patchLongSectionApi, patchLongSectionScheduler } from "./analyzer-section-workflow.patch.mjs";
import { patchDirectorAssetPersistence } from "./director-assets.patch.mjs";
import { patchSocialExport } from "./social-export.patch.mjs";
import { patchDirectorLeftRailLauncher, patchLeftRailTools, patchPromoLeftRailLauncher, patchReferenceLeftRailLauncher } from "./left-rail-tools.patch.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidebarPath = resolve(webRoot, "src/components/Sidebar.tsx");
const directorPath = resolve(webRoot, "src/components/AutoDirector.tsx");
const agentPath = resolve(webRoot, "src/components/LtxDirectorAgent.tsx");
const referenceChatPath = resolve(webRoot, "src/components/DirectorReferenceChat.tsx");
const leftRailPath = resolve(webRoot, "src/components/LeftRail.tsx");
const promoPath = resolve(webRoot, "src/components/PromoRangeSelector.tsx");
const apiPath = resolve(webRoot, "src/lib/api.ts");
const schedulerPath = resolve(webRoot, "src/lib/scheduler.ts");
const storePath = resolve(webRoot, "src/lib/store.ts");
const inferredDeclaration = "  let percent = current.percent;";
const numericDeclaration = "  let percent: number = current.percent;";

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: webRoot, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => signal ? rejectRun(new Error(`${command} stopped after ${signal}`)) : code !== 0 ? rejectRun(new Error(`${command} exited with code ${code}`)) : resolveRun());
  });
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not apply ${label}; expected source text was not found.`);
  return source.replace(from, to);
}

const originalSidebar = await readFile(sidebarPath, "utf8");
const originalDirector = await readFile(directorPath, "utf8");
const originalAgent = await readFile(agentPath, "utf8");
const originalReferenceChat = await readFile(referenceChatPath, "utf8");
const originalLeftRail = await readFile(leftRailPath, "utf8");
const originalPromo = await readFile(promoPath, "utf8");
const originalApi = await readFile(apiPath, "utf8");
const originalScheduler = await readFile(schedulerPath, "utf8");
const originalStore = await readFile(storePath, "utf8");
const needsNormalization = originalSidebar.includes(inferredDeclaration);
const visionFirstDirector = originalDirector.includes("const DIRECTOR_VERSION = 3;");

if (!needsNormalization && !originalSidebar.includes(numericDeclaration)) {
  throw new Error("Could not find the LipDub progress percentage declaration in Sidebar.tsx");
}

const directorEffectAnchor = `  useEffect(() => {\n    if (!songId || !analysis || clips.length === 0) {`;
const referenceListener = `  useEffect(() => {\n    const receiveReference = (event: Event) => {\n      const detail = (event as CustomEvent<{\n        kind?: "character" | "style" | "location" | "shot" | "note";\n        media?: "image" | "video" | "note";\n        name?: string;\n        url?: string;\n        sourceUrl?: string;\n        note?: string;\n      }>).detail;\n      if (!detail) return;\n      const kind = detail.kind ?? "style";\n      const note = String(detail.note ?? "").trim();\n      const name = String(detail.name ?? "reference").trim();\n      const anchorUrl = detail.url;\n      if (anchorUrl) addLookbook(anchorUrl);\n      if (kind === "character" && anchorUrl) setCharacter(anchorUrl);\n      setSession((current) => {\n        if (!current) return current;\n        if (kind === "note") {\n          const vision = note ? [current.vision.trim(), note].filter(Boolean).join("\\n") : current.vision;\n          return { ...current, vision };\n        }\n        const description = note || name;\n        const referenceLine = description ? kind + " reference: " + description : kind + " visual reference supplied";\n        const mustInclude = [current.mustInclude.trim(), referenceLine].filter(Boolean).join("\\n");\n        return { ...current, mustInclude, characterUrl: kind === "character" && anchorUrl ? anchorUrl : current.characterUrl, characterApproved: kind === "character" && anchorUrl ? false : current.characterApproved };\n      });\n      setDirectorError(null);\n      setOpen(true);\n    };\n    window.addEventListener("mvs-director-reference", receiveReference as EventListener);\n    return () => window.removeEventListener("mvs-director-reference", receiveReference as EventListener);\n  }, [addLookbook, setCharacter]);\n\n${directorEffectAnchor}`;

let patchedDirector = originalDirector;
if (!patchedDirector.includes('window.addEventListener("mvs-director-reference"')) {
  patchedDirector = replaceRequired(patchedDirector, directorEffectAnchor, referenceListener, "Director reference chat listener");
}
if (!visionFirstDirector) {
  patchedDirector = patchDirectorStatus(patchedDirector, replaceRequired);
  patchedDirector = patchDirectorEditing(patchedDirector, replaceRequired);
  patchedDirector = patchSocialExport(patchedDirector, replaceRequired);
} else {
  console.log("[web build] Director v3 owns its production controls; skipped legacy v2 source patches.");
}

const oldApiErrorMessage = `    const msg = parsed?.error ?? text;\n    throw new ApiError(res.status, msg, parsed?.rateLimited === true);`;
const safeApiErrorMessage = `    const isHtml = /<!doctype|<html/i.test(text.slice(0, 300));\n    const msg = parsed?.error ?? (isHtml\n      ? (res.status >= 500 ? "The Render service is temporarily unavailable. Please try again." : "The server returned an HTML error page instead of JSON.")\n      : text.slice(0, 500));\n    throw new ApiError(res.status, msg, parsed?.rateLimited === true);`;
let patchedApi = originalApi;
if (patchedApi.includes(oldApiErrorMessage)) patchedApi = patchedApi.replace(oldApiErrorMessage, safeApiErrorMessage);

const oldSliceAudio = `export async function sliceAudio(audioUrl: string, start: number, end: number): Promise<{ url: string }> {\n  return jsonOrThrow(\n    await fetch("/api/audio/slice", {\n      method: "POST",\n      headers: { "content-type": "application/json" },\n      body: JSON.stringify({ audioUrl, start, end }),\n    })\n  );\n}`;
const retryingSliceAudio = `export async function sliceAudio(audioUrl: string, start: number, end: number): Promise<{ url: string }> {\n  const request = () => fetch("/api/audio/slice", {\n    method: "POST",\n    headers: { "content-type": "application/json" },\n    body: JSON.stringify({ audioUrl, start, end }),\n  });\n  let response = await request();\n  if (response.status >= 500) {\n    await new Promise((resolveRetry) => setTimeout(resolveRetry, 2500));\n    response = await request();\n  }\n  return jsonOrThrow(response);\n}`;
if (patchedApi.includes(oldSliceAudio)) patchedApi = patchedApi.replace(oldSliceAudio, retryingSliceAudio);
patchedApi = patchLongSectionApi(patchedApi);

let patchedScheduler = originalScheduler;
if (!patchedScheduler.includes("Character conditioning is required.")) patchedScheduler = patchDirectorAgentRuntime(patchedScheduler, replaceRequired);
patchedScheduler = patchLongSectionScheduler(patchedScheduler);

const patchedStore = patchAnalyzerDefinedClips(originalStore);
let patchedAgent = patchOptionalCharacterConditioning(originalAgent, replaceRequired);
patchedAgent = patchDirectorChat(patchedAgent, replaceRequired);
patchedAgent = patchDirectorLeftRailLauncher(patchedAgent, replaceRequired);
patchedAgent = patchDirectorMultiCharacter(patchedAgent, replaceRequired);
patchedAgent = patchDirectorCharacterIdentity(patchedAgent, replaceRequired);
let patchedReferenceChat = patchDirectorReferenceChat(originalReferenceChat, replaceRequired);
patchedReferenceChat = patchDirectorAssetPersistence(patchedReferenceChat);
patchedReferenceChat = patchReferenceLeftRailLauncher(patchedReferenceChat);
const patchedLeftRail = patchLeftRailTools(originalLeftRail, replaceRequired);
const patchedPromo = patchPromoLeftRailLauncher(originalPromo, replaceRequired);

try {
  if (needsNormalization) {
    await writeFile(sidebarPath, originalSidebar.replace(inferredDeclaration, numericDeclaration), "utf8");
    console.log("[web build] Normalized LipDub progress percentage to number.");
  }
  await writeFile(directorPath, patchedDirector, "utf8");
  console.log("[web build] Kept Director source build-compatible for saved sessions.");
  if (!visionFirstDirector) console.log("[web build] Added social media export presets to the final-cut screen.");
  await writeFile(apiPath, patchedApi, "utf8");
  await writeFile(schedulerPath, patchedScheduler, "utf8");
  await writeFile(storePath, patchedStore, "utf8");
  console.log("[web build] Analyzer sections now define timeline clip lengths; long sections generate internally in Agnes-sized segments.");
  await writeFile(agentPath, patchedAgent, "utf8");
  await writeFile(referenceChatPath, patchedReferenceChat, "utf8");
  await writeFile(leftRailPath, patchedLeftRail, "utf8");
  await writeFile(promoPath, patchedPromo, "utf8");
  console.log("[web build] Moved Director, References, and Promo launchers into the left rail so the timeline stays clear.");
  console.log("[web build] Enabled Director chat, reusable assets, and section-by-section credit-protected approval.");
  console.log("[web build] Enabled Director session v4 multi-character approvals and legacy migration.");
  console.log("[web build] Bound selected character identities to their matching reference images.");
  await run("tsc", ["--noEmit"]);
  await run("vite", ["build"]);
} finally {
  await writeFile(sidebarPath, originalSidebar, "utf8");
  await writeFile(directorPath, originalDirector, "utf8");
  await writeFile(apiPath, originalApi, "utf8");
  await writeFile(schedulerPath, originalScheduler, "utf8");
  await writeFile(storePath, originalStore, "utf8");
  await writeFile(agentPath, originalAgent, "utf8");
  await writeFile(referenceChatPath, originalReferenceChat, "utf8");
  await writeFile(leftRailPath, originalLeftRail, "utf8");
  await writeFile(promoPath, originalPromo, "utf8");
}