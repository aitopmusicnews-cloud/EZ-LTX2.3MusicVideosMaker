export function patchDirectorMultiCharacter(source, replaceRequired) {
  let patched = source;

  const visionImport = 'import { buildVisionTimelineClips } from "../lib/directorAgentVision.js";';
  const multiImports = `${visionImport}\nimport { migrateDirectorCharacterState, sanitizeCharacterSelections, selectionForClip, toggleApprovedCharacter } from "../lib/directorCharacterState.js";\nimport { buildApprovalReferenceImages, chooseApprovedShotSeed, resolveCharacterReferenceUrls } from "../lib/directorCharacterMedia.js";\nimport { DirectorCharacterApproval, type CharacterOption } from "./DirectorCharacterControls.js";`;
  if (!patched.includes('DirectorCharacterApproval')) {
    patched = replaceRequired(patched, visionImport, multiImports, "Director multi-character imports");
  }

  const oldApprovalGenerator = `async function generateApprovalImage(prompt: string, referenceUrl?: string): Promise<string> {\n  const { id } = await startTextToImage({ prompt: prompt.trim(), promptText: prompt.trim(), model: "openrouter_image_flash", ratio: "1920:1080", ...(referenceUrl ? { referenceImages: [{ uri: referenceUrl }] } : {}) });\n  const task = await pollTask(id); const imageUrl = task.outputUrl || (task.output as any)?.imageUrl || (task.output as any)?.[0] || (task.output as any)?.url;\n  if ((task.status || "").toUpperCase() !== "SUCCEEDED" || !imageUrl) throw new Error(task.error ?? "Image generation did not return an image.");\n  void saveImageToLibrary({ id: \`img-\${crypto.randomUUID().slice(0, 8)}\`, name: prompt.trim().slice(0, 60), url: imageUrl, source: "generated", prompt: prompt.trim(), model: "openrouter_image_flash" }).catch((err) => console.warn("Director approval image library save failed", err));\n  return imageUrl;\n}`;
  const multiApprovalGenerator = `async function generateApprovalImage(prompt: string, referenceUrls: string[] = []): Promise<string> {\n  const referenceImages = buildApprovalReferenceImages(undefined, referenceUrls);\n  const { id } = await startTextToImage({ prompt: prompt.trim(), promptText: prompt.trim(), model: "openrouter_image_flash", ratio: "1920:1080", ...(referenceImages.length ? { referenceImages } : {}) });\n  const task = await pollTask(id); const imageUrl = task.outputUrl || (task.output as any)?.imageUrl || (task.output as any)?.[0] || (task.output as any)?.url;\n  if ((task.status || "").toUpperCase() !== "SUCCEEDED" || !imageUrl) throw new Error(task.error ?? "Image generation did not return an image.");\n  void saveImageToLibrary({ id: \`img-\${crypto.randomUUID().slice(0, 8)}\`, name: prompt.trim().slice(0, 60), url: imageUrl, source: "generated", prompt: prompt.trim(), model: "openrouter_image_flash" }).catch((err) => console.warn("Director approval image library save failed", err));\n  return imageUrl;\n}`;
  if (!patched.includes("generateApprovalImage(prompt: string, referenceUrls: string[] = [])")) {
    patched = replaceRequired(patched, oldApprovalGenerator, multiApprovalGenerator, "Director multi-reference approval image generator");
  }

  const oldTypes = `type VisualApproval = { url: string; approved: boolean };\ntype AgentSession = { vision: string; mustInclude: string; avoid: string; characterRequired: boolean; plan: LtxDirectorPlan | null; planAccepted: boolean; productionStarted: boolean; characterApproved: boolean; treatmentApproved: boolean; sceneApprovals: Record<string, VisualApproval>; shotApprovals: Record<string, VisualApproval> };`;
  const newTypes = `type VisualApproval = { url: string; approved: boolean };\ntype PendingAssetEdit = { targetType: "scene_image" | "shot_image" | "clip"; clipId: string; prompt?: string; regenerate?: boolean };\ntype AgentSession = { vision: string; mustInclude: string; avoid: string; characterRequired: boolean; plan: LtxDirectorPlan | null; planAccepted: boolean; productionStarted: boolean; characterApproved?: boolean; approvedCharacterIds: string[]; characterSelections: Record<string, string[]>; pendingAssetEdits: Record<string, PendingAssetEdit>; treatmentApproved: boolean; sceneApprovals: Record<string, VisualApproval>; shotApprovals: Record<string, VisualApproval> };`;
  if (!patched.includes("type PendingAssetEdit")) {
    patched = replaceRequired(patched, oldTypes, newTypes, "Director multi-character session types");
  }

  if (patched.includes("const SESSION_VERSION = 3;")) {
    patched = patched.replace("const SESSION_VERSION = 3;", "const SESSION_VERSION = 4;");
  }

  const storageFns = `function referenceStorageKey(songId: string) { return \`mvs-director-reference-chat-v1-\${songId}\`; }\nfunction sessionStorageKey(songId: string) { return \`mvs-ltx-director-agent-v\${SESSION_VERSION}-\${songId}\`; }`;
  const storageFnsWithLegacy = `${storageFns}\nfunction legacySessionStorageKeys(songId: string) { return [\`mvs-ltx-director-agent-v3-\${songId}\`, \`mvs-ltx-director-agent-v2-\${songId}\`]; }\nfunction assetEditKey(type: "scene_image" | "shot_image" | "clip", clipId: string) { return \`\${type}:\${clipId}\`; }`;
  if (!patched.includes("function assetEditKey")) {
    patched = replaceRequired(patched, storageFns, storageFnsWithLegacy, "Director multi-character storage helpers");
  }

  const oldEmpty = `function emptySession(): AgentSession { return { vision: "", mustInclude: "", avoid: "", characterRequired: false, plan: null, planAccepted: false, productionStarted: false, characterApproved: false, treatmentApproved: false, sceneApprovals: {}, shotApprovals: {} }; }`;
  const newEmpty = `function emptySession(): AgentSession { return { vision: "", mustInclude: "", avoid: "", characterRequired: false, plan: null, planAccepted: false, productionStarted: false, characterApproved: false, approvedCharacterIds: [], characterSelections: {}, pendingAssetEdits: {}, treatmentApproved: false, sceneApprovals: {}, shotApprovals: {} }; }`;
  if (!patched.includes("approvedCharacterIds: []")) {
    patched = replaceRequired(patched, oldEmpty, newEmpty, "Director multi-character empty session");
  }

  const oldRestore = `  useEffect(() => { if (!songId) { setOpen(false); setSession(emptySession()); return; } try { const raw = localStorage.getItem(sessionStorageKey(songId)); const parsed = raw ? JSON.parse(raw) : {}; setSession({ ...emptySession(), ...parsed, sceneApprovals: parsed.sceneApprovals ?? {}, shotApprovals: parsed.shotApprovals ?? {} }); } catch { setSession(emptySession()); } }, [songId]);`;
  const newRestore = `  useEffect(() => { if (!songId) { setOpen(false); setSession(emptySession()); return; } try { const raw = localStorage.getItem(sessionStorageKey(songId)) ?? legacySessionStorageKeys(songId).map((key) => localStorage.getItem(key)).find(Boolean) ?? null; const parsed = raw ? JSON.parse(raw) : {}; setSession({ ...emptySession(), ...parsed, approvedCharacterIds: Array.isArray(parsed.approvedCharacterIds) ? parsed.approvedCharacterIds : [], characterSelections: parsed.characterSelections && typeof parsed.characterSelections === "object" ? parsed.characterSelections : {}, pendingAssetEdits: parsed.pendingAssetEdits && typeof parsed.pendingAssetEdits === "object" ? parsed.pendingAssetEdits : {}, sceneApprovals: parsed.sceneApprovals ?? {}, shotApprovals: parsed.shotApprovals ?? {} }); } catch { setSession(emptySession()); } }, [songId]);`;
  if (!patched.includes("legacySessionStorageKeys(songId).map")) {
    patched = replaceRequired(patched, oldRestore, newRestore, "Director legacy session restore");
  }

  const characterAnchor = `  const characterReferences = useMemo(() => readyReferences.filter((reference) => reference.kind === "character" && (reference.anchorUrl || reference.url)), [readyReferences]);`;
  const characterState = `${characterAnchor}\n  const characterOptions = useMemo<CharacterOption[]>(() => { const options = characterReferences.map((reference) => ({ id: reference.id, name: reference.name, url: reference.anchorUrl ?? reference.url })); if (characterImageUrl && !options.some((option) => option.id === "store-character")) options.unshift({ id: "store-character", name: "Approved project character", url: characterImageUrl }); return options; }, [characterReferences, characterImageUrl]);\n  useEffect(() => { if (!songId) return; const validCharacterIds = characterOptions.map((option) => option.id); setSession((current) => { const bibleReferenceId = current.plan?.characterBible.referenceId ?? null; const legacyCharacterReferenceId = bibleReferenceId && validCharacterIds.includes(bibleReferenceId) ? bibleReferenceId : characterImageUrl && validCharacterIds.includes("store-character") ? "store-character" : null; const migrated = migrateDirectorCharacterState({ approvedCharacterIds: current.approvedCharacterIds, characterSelections: current.characterSelections, legacyCharacterApproved: current.characterApproved === true, legacyCharacterReferenceId, validCharacterIds }); const clipIds = new Set(current.plan?.shots.map((shot) => shot.clipId) ?? []); const pendingAssetEdits = current.plan ? Object.fromEntries(Object.entries(current.pendingAssetEdits ?? {}).filter(([, edit]) => clipIds.has(edit.clipId))) : {}; const sameApproved = JSON.stringify(migrated.approvedCharacterIds) === JSON.stringify(current.approvedCharacterIds); const sameSelections = JSON.stringify(migrated.characterSelections) === JSON.stringify(current.characterSelections); const samePending = JSON.stringify(pendingAssetEdits) === JSON.stringify(current.pendingAssetEdits); if (sameApproved && sameSelections && samePending && current.characterApproved === false) return current; return { ...current, ...migrated, pendingAssetEdits, characterApproved: false }; }); }, [songId, characterOptions, characterImageUrl]);`;
  if (!patched.includes("const characterOptions = useMemo<CharacterOption[]>")) {
    patched = replaceRequired(patched, characterAnchor, characterState, "Director character migration state");
  }

  const updateSessionAnchor = `  const updateSession = (patch: Partial<AgentSession>) => setSession((current) => ({ ...current, ...patch }));`;
  const updateSessionWithCharacters = `${updateSessionAnchor}\n  const toggleCharacterApproval = (id: string) => setSession((current) => { const approvedCharacterIds = toggleApprovedCharacter(current.approvedCharacterIds, id); return { ...current, approvedCharacterIds, characterSelections: sanitizeCharacterSelections(current.characterSelections, approvedCharacterIds), characterApproved: false }; });`;
  if (!patched.includes("const toggleCharacterApproval")) {
    patched = replaceRequired(patched, updateSessionAnchor, updateSessionWithCharacters, "Director character approval handler");
  }

  const resolveReferenceAnchor = `  const resolveReferenceUrl = (referenceId: string | null) => { if (!referenceId) return ""; if (referenceId === "store-character") return characterImageUrl ?? ""; const reference = readyReferences.find((item) => item.id === referenceId); return reference?.anchorUrl ?? (reference?.media === "image" ? reference.url ?? "" : ""); };`;
  const resolveCharacterMedia = `${resolveReferenceAnchor}\n  const selectedCharacterUrlsForShot = (shot: LtxShotPlan) => { const selectedIds = selectionForClip(session.characterSelections, shot.clipId, shot.conditioningReferenceId).filter((id) => session.approvedCharacterIds.includes(id)); return resolveCharacterReferenceUrls(selectedIds, characterReferences, characterImageUrl ?? null); };`;
  if (!patched.includes("const selectedCharacterUrlsForShot")) {
    patched = replaceRequired(patched, resolveReferenceAnchor, resolveCharacterMedia, "Director selected character media resolver");
  }

  const oldSceneVisual = `  const generateSceneVisual = async (key: string, prompt: string, referenceUrl?: string) => {\n    setError(null); setBusy(\`Generating scene image for \${key}\`);\n    try { const url = await generateApprovalImage(prompt, referenceUrl); setSceneApproval(key, { url, approved: false }); toast.success("Scene image generated for approval"); } catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); toast.error(\`Scene image generation failed: \${message}\`); } finally { setBusy(null); }\n  };`;
  const newSceneVisual = `  const generateSceneVisual = async (key: string, prompt: string, referenceUrls: string[] = []) => {\n    setError(null); setBusy(\`Generating scene image for \${key}\`);\n    try { const url = await generateApprovalImage(prompt, referenceUrls); setSceneApproval(key, { url, approved: false }); toast.success("Scene image generated for approval"); } catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); toast.error(\`Scene image generation failed: \${message}\`); } finally { setBusy(null); }\n  };`;
  if (!patched.includes("generateSceneVisual = async (key: string, prompt: string, referenceUrls: string[] = [])")) {
    patched = replaceRequired(patched, oldSceneVisual, newSceneVisual, "Director scene multi-reference generation");
  }

  const oldShotVisual = `  const generateShotVisual = async (key: string, prompt: string, referenceUrl?: string) => {\n    setError(null); setBusy(\`Generating shot image for \${key}\`);\n    try { const url = await generateApprovalImage(prompt, referenceUrl); setShotApproval(key, { url, approved: false }); toast.success("Shot image generated for approval"); } catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); toast.error(\`Shot image generation failed: \${message}\`); } finally { setBusy(null); }\n  };`;
  const newShotVisual = `  const generateShotVisual = async (key: string, prompt: string, referenceUrls: string[] = []) => {\n    setError(null); setBusy(\`Generating shot image for \${key}\`);\n    try { const url = await generateApprovalImage(prompt, referenceUrls); setShotApproval(key, { url, approved: false }); toast.success("Shot image generated for approval"); } catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); toast.error(\`Shot image generation failed: \${message}\`); } finally { setBusy(null); }\n  };`;
  if (!patched.includes("generateShotVisual = async (key: string, prompt: string, referenceUrls: string[] = [])")) {
    patched = replaceRequired(patched, oldShotVisual, newShotVisual, "Director shot multi-reference generation");
  }

  const oldPlanReset = `updateSession({ plan, planAccepted: false, productionStarted: false, characterApproved: false, treatmentApproved: false, sceneApprovals: {}, shotApprovals: {} });`;
  const newPlanReset = `setSession((current) => { const nextClipIds = new Set(plan.shots.map((shot) => shot.clipId)); return { ...current, plan, planAccepted: false, productionStarted: false, characterApproved: false, approvedCharacterIds: current.approvedCharacterIds, characterSelections: Object.fromEntries(Object.entries(current.characterSelections).filter(([clipId]) => nextClipIds.has(clipId))), pendingAssetEdits: Object.fromEntries(Object.entries(current.pendingAssetEdits).filter(([, edit]) => nextClipIds.has(edit.clipId))), treatmentApproved: false, sceneApprovals: {}, shotApprovals: {} }; });`;
  if (patched.includes(oldPlanReset)) {
    patched = patched.replace(oldPlanReset, newPlanReset);
  }

  const oldProductionGate = `    if ((characterConditioningRequired && !session.characterApproved) || !session.treatmentApproved || !scenesApproved || !shotsApproved) { setError(characterConditioningRequired ? "Production is locked until the character, treatment text, every scene image, and every shot image are approved." : "Production is locked until the treatment text, every scene image, and every shot image are approved."); return; }`;
  const newProductionGate = `    if ((characterConditioningRequired && session.approvedCharacterIds.length === 0) || !session.treatmentApproved || !scenesApproved || !shotsApproved) { setError(characterConditioningRequired ? "Production is locked until at least one character, the treatment text, every scene image, and every shot image are approved." : "Production is locked until the treatment text, every scene image, and every shot image are approved."); return; }`;
  if (patched.includes(oldProductionGate)) patched = patched.replace(oldProductionGate, newProductionGate);

  const oldSectionSeed = `    const conditioningUrl = resolveReferenceUrl(shot.conditioningReferenceId) || undefined;\n    if (shot.requiresCharacter && session.approvedCharacterIds.length === 0) { setError(\`\${shot.sectionLabel} needs at least one approved project character before video generation.\`); return; }\n    if (shot.requiresCharacter && !conditioningUrl) { setError(\`\${shot.sectionLabel} needs a character asset before video generation.\`); return; }\n    const previousReady = clipIndex > 0 && timelineClips[clipIndex - 1]?.status === "ready" && Boolean(timelineClips[clipIndex - 1]?.videoUrl);\n    const source = conditioningUrl ? "imageToVideo" : previousReady ? "continue" : "textToVideo";`;
  const approvedSectionSeed = `    const approvedShotSeed = chooseApprovedShotSeed(session.shotApprovals[clipId]);\n    if (shot.requiresCharacter && session.approvedCharacterIds.length === 0) { setError(\`\${shot.sectionLabel} needs at least one approved project character before video generation.\`); return; }\n    if (shot.requiresCharacter && !approvedShotSeed) { setError(\`\${shot.sectionLabel} needs an approved shot image before video generation.\`); return; }\n    const previousReady = clipIndex > 0 && timelineClips[clipIndex - 1]?.status === "ready" && Boolean(timelineClips[clipIndex - 1]?.videoUrl);\n    const source = approvedShotSeed ? "imageToVideo" : previousReady ? "continue" : "textToVideo";`;
  if (!patched.includes("chooseApprovedShotSeed(session.shotApprovals[clipId])")) {
    patched = replaceRequired(patched, oldSectionSeed, approvedSectionSeed, "Director approved shot seed for section generation");
  }
  patched = patched.replace(`      seedImageUrl: conditioningUrl,\n      archetypeUrl: conditioningUrl,`, `      seedImageUrl: approvedShotSeed,\n      archetypeUrl: approvedShotSeed,`);
  patched = patched.replace(`      seedImageUrl: conditioningUrl || "",`, `      seedImageUrl: approvedShotSeed || "",`);

  const oldGlobalVisualRegenerate = `            await generateShotVisual(action.clipId, imagePrompt, conditioningUrl || characterImageUrl || undefined);`;
  if (patched.includes(oldGlobalVisualRegenerate)) {
    patched = patched.replace(oldGlobalVisualRegenerate, `            await generateShotVisual(action.clipId, imagePrompt, [conditioningUrl || characterImageUrl].filter((url): url is string => Boolean(url)));`);
  }
  const oldGlobalImageEdit = `      if (action.type === "edit_scene_image") await generateSceneVisual(action.clipId, action.prompt, referenceUrl);\n      else await generateShotVisual(action.clipId, action.prompt, referenceUrl);`;
  const arrayGlobalImageEdit = `      if (action.type === "edit_scene_image") await generateSceneVisual(action.clipId, action.prompt, referenceUrl ? [referenceUrl] : []);\n      else await generateShotVisual(action.clipId, action.prompt, referenceUrl ? [referenceUrl] : []);`;
  if (patched.includes(oldGlobalImageEdit)) patched = patched.replace(oldGlobalImageEdit, arrayGlobalImageEdit);

  const sceneMapPrefix = `{session.plan.shots.map((shot) => { const sceneApproval = session.sceneApprovals[shot.clipId]; const referenceUrl = resolveReferenceUrl(shot.conditioningReferenceId) || characterImageUrl || undefined; return`;
  const multiSceneMapPrefix = `{session.plan.shots.map((shot) => { const sceneApproval = session.sceneApprovals[shot.clipId]; const selectedCharacterUrls = selectedCharacterUrlsForShot(shot); const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); return`;
  if (patched.includes(sceneMapPrefix)) patched = patched.replace(sceneMapPrefix, multiSceneMapPrefix);
  const oldSceneButtonCall = `generateSceneVisual(shot.clipId, \`Cinematic scene board for \${shot.sectionLabel}. \${session.plan!.treatment.visualStyle}. \${session.plan!.treatment.colorPalette}. \${shot.prompt}. Continuity: \${shot.continuityNotes}.\`, referenceUrl)`;
  const multiSceneButtonCall = `generateSceneVisual(shot.clipId, \`Cinematic scene board for \${shot.sectionLabel}. \${session.plan!.treatment.visualStyle}. \${session.plan!.treatment.colorPalette}. \${shot.prompt}. Continuity: \${shot.continuityNotes}.\`, sceneReferenceUrls)`;
  if (patched.includes(oldSceneButtonCall)) patched = patched.replace(oldSceneButtonCall, multiSceneButtonCall);

  const shotMapPrefix = `{session.plan.shots.map((shot) => { const promptWords = words(shot.prompt); const conditioningReady = !shot.requiresCharacter || Boolean(resolveReferenceUrl(shot.conditioningReferenceId)); const shotApproval = session.shotApprovals[shot.clipId]; return`;
  const multiShotMapPrefix = `{session.plan.shots.map((shot) => { const promptWords = words(shot.prompt); const selectedCharacterUrls = selectedCharacterUrlsForShot(shot); const conditioningReady = !shot.requiresCharacter || selectedCharacterUrls.length > 0; const shotApproval = session.shotApprovals[shot.clipId]; const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); return`;
  if (patched.includes(shotMapPrefix)) patched = patched.replace(shotMapPrefix, multiShotMapPrefix);
  const oldShotButtonCall = `generateShotVisual(shot.clipId, \`\${shot.prompt}. Continuity: \${shot.continuityNotes}. Transition: \${shot.transition}.\`, resolveReferenceUrl(shot.conditioningReferenceId) || characterImageUrl || undefined)`;
  const multiShotButtonCall = `generateShotVisual(shot.clipId, \`\${shot.prompt}. Continuity: \${shot.continuityNotes}. Transition: \${shot.transition}.\`, shotReferenceUrls)`;
  if (patched.includes(oldShotButtonCall)) patched = patched.replace(oldShotButtonCall, multiShotButtonCall);

  const oldCharacterSection = `<section style={sectionStyle}><h3 style={sectionTitleStyle}>1. Characters — optional visual reference</h3><p style={helpStyle}>Add and approve a character reference only when a shot needs consistent character conditioning. Text-only shots can proceed without one.</p>{characterImageUrl ? <div style={approvalCardStyle}><img src={characterImageUrl} alt="Project character reference" style={approvalImageStyle} /><div style={approvalActionsStyle}><span style={approvalStatusStyle}>{session.characterApproved ? "✓ Character approved" : "Waiting for character approval"}</span><button type="button" className="btn primary" onClick={() => updateSession({ characterApproved: true })}>{session.characterApproved ? "Character approved ✓" : "Approve character"}</button><button type="button" className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-reference-chat"))}>Replace reference</button></div></div> : <div style={helpStyle}>No character reference is active. Text-only shots can continue without character conditioning.</div>}</section>`;
  const newCharacterSection = `<section style={sectionStyle}><h3 style={sectionTitleStyle}>1. Characters — approve one or more references</h3><p style={helpStyle}>Approve every recurring character you may use. Individual scenes, shots, and clips can select from these approved identities without changing timing or clip count.</p><DirectorCharacterApproval characters={characterOptions} approvedIds={session.approvedCharacterIds} onToggle={toggleCharacterApproval} /><div style={smallStyle}>{session.approvedCharacterIds.length} project character{session.approvedCharacterIds.length === 1 ? "" : "s"} approved</div></section>`;
  if (!patched.includes("approve one or more references")) {
    patched = replaceRequired(patched, oldCharacterSection, newCharacterSection, "Director multi-character approval UI");
  }

  const oldReset = `  const resetAgent = () => { localStorage.removeItem(sessionStorageKey(songId)); setSession(emptySession()); setError(null); };`;
  const newReset = `  const resetAgent = () => { localStorage.removeItem(sessionStorageKey(songId)); for (const key of legacySessionStorageKeys(songId)) localStorage.removeItem(key); setSession(emptySession()); setError(null); };`;
  if (patched.includes(oldReset)) patched = patched.replace(oldReset, newReset);

  return patched;
}
