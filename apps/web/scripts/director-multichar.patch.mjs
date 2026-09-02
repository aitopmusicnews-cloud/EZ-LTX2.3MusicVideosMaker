export function patchDirectorMultiCharacter(source, replaceRequired) {
  let patched = source;

  const visionImport = 'import { buildVisionTimelineClips } from "../lib/directorAgentVision.js";';
  const multiImports = `${visionImport}\nimport { migrateDirectorCharacterState, sanitizeCharacterSelections, toggleApprovedCharacter } from "../lib/directorCharacterState.js";\nimport { DirectorCharacterApproval, type CharacterOption } from "./DirectorCharacterControls.js";`;
  if (!patched.includes('DirectorCharacterApproval')) {
    patched = replaceRequired(patched, visionImport, multiImports, "Director multi-character imports");
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

  const oldPlanReset = `updateSession({ plan, planAccepted: false, productionStarted: false, characterApproved: false, treatmentApproved: false, sceneApprovals: {}, shotApprovals: {} });`;
  const newPlanReset = `setSession((current) => { const nextClipIds = new Set(plan.shots.map((shot) => shot.clipId)); return { ...current, plan, planAccepted: false, productionStarted: false, characterApproved: false, approvedCharacterIds: current.approvedCharacterIds, characterSelections: Object.fromEntries(Object.entries(current.characterSelections).filter(([clipId]) => nextClipIds.has(clipId))), pendingAssetEdits: Object.fromEntries(Object.entries(current.pendingAssetEdits).filter(([, edit]) => nextClipIds.has(edit.clipId))), treatmentApproved: false, sceneApprovals: {}, shotApprovals: {} }; });`;
  if (patched.includes(oldPlanReset)) {
    patched = patched.replace(oldPlanReset, newPlanReset);
  }

  const oldProductionGate = `    if ((characterConditioningRequired && !session.characterApproved) || !session.treatmentApproved || !scenesApproved || !shotsApproved) { setError(characterConditioningRequired ? "Production is locked until the character, treatment text, every scene image, and every shot image are approved." : "Production is locked until the treatment text, every scene image, and every shot image are approved."); return; }`;
  const newProductionGate = `    if ((characterConditioningRequired && session.approvedCharacterIds.length === 0) || !session.treatmentApproved || !scenesApproved || !shotsApproved) { setError(characterConditioningRequired ? "Production is locked until at least one character, the treatment text, every scene image, and every shot image are approved." : "Production is locked until the treatment text, every scene image, and every shot image are approved."); return; }`;
  if (patched.includes(oldProductionGate)) patched = patched.replace(oldProductionGate, newProductionGate);

  const sectionCharacterCheck = `    if (shot.requiresCharacter && !conditioningUrl) { setError(\`\${shot.sectionLabel} needs a character asset before video generation.\`); return; }`;
  const sectionCharacterApprovalCheck = `    if (shot.requiresCharacter && session.approvedCharacterIds.length === 0) { setError(\`\${shot.sectionLabel} needs at least one approved project character before video generation.\`); return; }\n${sectionCharacterCheck}`;
  if (!patched.includes("needs at least one approved project character")) {
    patched = replaceRequired(patched, sectionCharacterCheck, sectionCharacterApprovalCheck, "Director section character approval gate");
  }

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
