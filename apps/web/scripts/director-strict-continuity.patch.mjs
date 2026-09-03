export function patchDirectorStrictContinuity(source, replaceRequired) {
  let patched = source;

  const mediaImport = 'import { buildApprovalReferenceImages, buildCharacterIdentityInstruction, chooseApprovedShotSeed, resolveCharacterIdentities } from "../lib/directorCharacterMedia.js";';
  const continuityImport = `${mediaImport}\nimport { buildStrictContinuityInstruction, buildStrictVideoContinuityInstruction, findPriorApprovedContinuityAnchor } from "../lib/directorContinuityLock.js";`;
  if (!patched.includes('from "../lib/directorContinuityLock.js"')) {
    patched = replaceRequired(patched, mediaImport, continuityImport, "Director strict continuity imports");
  }

  const oldResolver = '  const selectedCharactersForShot = (shot: LtxShotPlan) => { const selectedIds = selectionForClip(session.characterSelections, shot.clipId, shot.conditioningReferenceId).filter((id) => session.approvedCharacterIds.includes(id)); return resolveCharacterIdentities(selectedIds, characterReferences, characterImageUrl ?? null); };\n  const selectedCharacterUrlsForShot = (shot: LtxShotPlan) => selectedCharactersForShot(shot).map((identity) => identity.url);';
  const newResolver = '  const selectedCharacterIdsForShot = (shot: LtxShotPlan) => selectionForClip(session.characterSelections, shot.clipId, shot.conditioningReferenceId).filter((id) => session.approvedCharacterIds.includes(id));\n  const selectedCharactersForShot = (shot: LtxShotPlan) => resolveCharacterIdentities(selectedCharacterIdsForShot(shot), characterReferences, characterImageUrl ?? null);\n  const selectedCharacterUrlsForShot = (shot: LtxShotPlan) => selectedCharactersForShot(shot).map((identity) => identity.url);\n  const continuityAnchorForShot = (shot: LtxShotPlan) => session.plan ? findPriorApprovedContinuityAnchor({ currentClipId: shot.clipId, shots: session.plan.shots, shotApprovals: session.shotApprovals, sceneApprovals: session.sceneApprovals, characterSelections: Object.fromEntries(session.plan.shots.map((candidate) => [candidate.clipId, selectedCharacterIdsForShot(candidate)])) }) : undefined;';
  if (!patched.includes("const continuityAnchorForShot")) {
    patched = replaceRequired(patched, oldResolver, newResolver, "Director continuity anchor resolver");
  }

  const oldScenePrefix = '{session.plan.shots.map((shot) => { const sceneApproval = session.sceneApprovals[shot.clipId]; const selectedCharacters = selectedCharactersForShot(shot); const selectedCharacterUrls = selectedCharacters.map((identity) => identity.url); const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const sceneIdentityInstruction = buildCharacterIdentityInstruction(selectedCharacters, sceneReferenceUrls); const scenePendingEdit = session.pendingAssetEdits[assetEditKey("scene_image", shot.clipId)]; return';
  const newScenePrefix = '{session.plan.shots.map((shot) => { const sceneApproval = session.sceneApprovals[shot.clipId]; const selectedCharacters = selectedCharactersForShot(shot); const selectedCharacterUrls = selectedCharacters.map((identity) => identity.url); const sceneContinuityAnchor = continuityAnchorForShot(shot); const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, [...selectedCharacterUrls, sceneContinuityAnchor?.url]).map((reference) => reference.uri); const sceneIdentityInstruction = buildCharacterIdentityInstruction(selectedCharacters, sceneReferenceUrls); const sceneStrictContinuityInstruction = buildStrictContinuityInstruction({ identities: selectedCharacters, continuityAnchorUrl: sceneContinuityAnchor?.url, referenceUrls: sceneReferenceUrls }); const scenePendingEdit = session.pendingAssetEdits[assetEditKey("scene_image", shot.clipId)]; return';
  if (!patched.includes("const sceneStrictContinuityInstruction")) {
    patched = replaceRequired(patched, oldScenePrefix, newScenePrefix, "Director scene strict continuity binding");
  }

  const oldSceneCall = 'generateSceneVisual(shot.clipId, `Cinematic scene board for ${shot.sectionLabel}. ${session.plan!.treatment.visualStyle}. ${session.plan!.treatment.colorPalette}. ${shot.prompt}. Continuity: ${shot.continuityNotes}. ${sceneIdentityInstruction}`, sceneReferenceUrls)';
  const newSceneCall = 'generateSceneVisual(shot.clipId, `Cinematic scene board for ${shot.sectionLabel}. ${session.plan!.treatment.visualStyle}. ${session.plan!.treatment.colorPalette}. ${shot.prompt}. Continuity: ${shot.continuityNotes}. ${sceneIdentityInstruction} ${sceneStrictContinuityInstruction}`, sceneReferenceUrls)';
  if (!patched.includes("${sceneStrictContinuityInstruction}")) {
    patched = replaceRequired(patched, oldSceneCall, newSceneCall, "Director scene strict continuity prompt");
  }

  const oldShotPrefix = '{session.plan.shots.map((shot) => { const promptWords = words(shot.prompt); const selectedCharacters = selectedCharactersForShot(shot); const selectedCharacterUrls = selectedCharacters.map((identity) => identity.url); const conditioningReady = !shot.requiresCharacter || selectedCharacterUrls.length > 0; const shotApproval = session.shotApprovals[shot.clipId]; const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const shotIdentityInstruction = buildCharacterIdentityInstruction(selectedCharacters, shotReferenceUrls); const shotPendingEdit = session.pendingAssetEdits[assetEditKey("shot_image", shot.clipId)]; return';
  const newShotPrefix = '{session.plan.shots.map((shot) => { const promptWords = words(shot.prompt); const selectedCharacters = selectedCharactersForShot(shot); const selectedCharacterUrls = selectedCharacters.map((identity) => identity.url); const conditioningReady = !shot.requiresCharacter || selectedCharacterUrls.length > 0; const shotApproval = session.shotApprovals[shot.clipId]; const shotContinuityAnchor = continuityAnchorForShot(shot); const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, [...selectedCharacterUrls, shotContinuityAnchor?.url]).map((reference) => reference.uri); const shotIdentityInstruction = buildCharacterIdentityInstruction(selectedCharacters, shotReferenceUrls); const shotStrictContinuityInstruction = buildStrictContinuityInstruction({ identities: selectedCharacters, continuityAnchorUrl: shotContinuityAnchor?.url, referenceUrls: shotReferenceUrls }); const shotPendingEdit = session.pendingAssetEdits[assetEditKey("shot_image", shot.clipId)]; return';
  if (!patched.includes("const shotStrictContinuityInstruction")) {
    patched = replaceRequired(patched, oldShotPrefix, newShotPrefix, "Director shot strict continuity binding");
  }

  const oldShotCall = 'generateShotVisual(shot.clipId, `${shot.prompt}. Continuity: ${shot.continuityNotes}. Transition: ${shot.transition}. ${shotIdentityInstruction}`, shotReferenceUrls)';
  const newShotCall = 'generateShotVisual(shot.clipId, `${shot.prompt}. Continuity: ${shot.continuityNotes}. Transition: ${shot.transition}. ${shotIdentityInstruction} ${shotStrictContinuityInstruction}`, shotReferenceUrls)';
  if (!patched.includes("${shotStrictContinuityInstruction}")) {
    patched = replaceRequired(patched, oldShotCall, newShotCall, "Director shot strict continuity prompt");
  }

  const preparedOld = `    const preparedCharacters = selectedCharactersForShot(shot);\n    const selectedCharacterUrls = preparedCharacters.map((identity) => identity.url);\n    const existingUrl = targetType === "scene_image" ? session.sceneApprovals[clipId]?.url : session.shotApprovals[clipId]?.url;\n    const referenceUrls = buildApprovalReferenceImages(existingUrl, selectedCharacterUrls).map((reference) => reference.uri);\n    const preparedIdentityInstruction = buildCharacterIdentityInstruction(preparedCharacters, referenceUrls);\n    const preparedPrompt = [pending.prompt, preparedIdentityInstruction].filter(Boolean).join(" ");\n    if (targetType === "scene_image") await generateSceneVisual(clipId, preparedPrompt, referenceUrls);\n    else await generateShotVisual(clipId, preparedPrompt, referenceUrls);`;
  const preparedNew = `    const preparedCharacters = selectedCharactersForShot(shot);\n    const selectedCharacterUrls = preparedCharacters.map((identity) => identity.url);\n    const existingUrl = targetType === "scene_image" ? session.sceneApprovals[clipId]?.url : session.shotApprovals[clipId]?.url;\n    const preparedContinuityAnchor = continuityAnchorForShot(shot);\n    const referenceUrls = buildApprovalReferenceImages(existingUrl, [...selectedCharacterUrls, preparedContinuityAnchor?.url]).map((reference) => reference.uri);\n    const preparedIdentityInstruction = buildCharacterIdentityInstruction(preparedCharacters, referenceUrls);\n    const preparedStrictContinuityInstruction = buildStrictContinuityInstruction({ identities: preparedCharacters, continuityAnchorUrl: preparedContinuityAnchor?.url, referenceUrls });\n    const preparedPrompt = [pending.prompt, preparedIdentityInstruction, preparedStrictContinuityInstruction].filter(Boolean).join(" ");\n    if (targetType === "scene_image") await generateSceneVisual(clipId, preparedPrompt, referenceUrls);\n    else await generateShotVisual(clipId, preparedPrompt, referenceUrls);`;
  if (!patched.includes("const preparedStrictContinuityInstruction")) {
    patched = replaceRequired(patched, preparedOld, preparedNew, "Director prepared-image strict continuity binding");
  }

  const sectionStart = patched.indexOf("  const generateSectionPreview = (clipId: string) => {");
  const sectionEndCandidate = patched.indexOf("\n  const updateCharacterSelection =", sectionStart);
  const sectionEndFallback = patched.indexOf("\n  const applyDirectorChatActions =", sectionStart);
  const sectionEnd = sectionEndCandidate >= 0 ? sectionEndCandidate : sectionEndFallback;
  if (sectionStart < 0 || sectionEnd < 0) throw new Error("Could not isolate Director section generation for strict continuity.");
  let section = patched.slice(sectionStart, sectionEnd);
  if (!section.includes("const videoContinuityInstruction")) {
    const approvedSeed = '    const approvedShotSeed = chooseApprovedShotSeed(session.shotApprovals[clipId]);';
    const approvedSeedWithContinuity = `${approvedSeed}\n    const videoContinuityInstruction = buildStrictVideoContinuityInstruction(selectedCharactersForShot(shot));\n    const videoPrompt = [shot.prompt, videoContinuityInstruction].filter(Boolean).join(" ");`;
    section = replaceRequired(section, approvedSeed, approvedSeedWithContinuity, "Director Agnes strict continuity prompt");
    section = section.replaceAll("      prompt: shot.prompt,", "      prompt: videoPrompt,");
    if (!section.includes("prompt: videoPrompt")) throw new Error("Director Agnes continuity prompt was not wired into section generation.");
  }
  patched = patched.slice(0, sectionStart) + section + patched.slice(sectionEnd);

  const characterHelp = '<section style={sectionStyle}><h3 style={sectionTitleStyle}>1. Characters — approve one or more references</h3><p style={helpStyle}>Approve every recurring character you may use. Individual scenes, shots, and clips can select from these approved identities without changing timing or clip count.</p><DirectorCharacterApproval';
  const characterHelpWithLock = '<section style={sectionStyle}><h3 style={sectionTitleStyle}>1. Characters — approve one or more references</h3><p style={helpStyle}>Approve every recurring character you may use. Individual scenes, shots, and clips can select from these approved identities without changing timing or clip count.</p><div style={visionOverrideStyle}>✓ Strict continuity lock active: skin tone, identity, wardrobe, props, equipment, vehicles, instruments, and recurring set details stay consistent across approved images and Agnes clips unless your current script explicitly changes them.</div><DirectorCharacterApproval';
  if (!patched.includes("Strict continuity lock active")) {
    patched = replaceRequired(patched, characterHelp, characterHelpWithLock, "Director visible strict continuity status");
  }

  if (!patched.includes("findPriorApprovedContinuityAnchor")) throw new Error("Director strict continuity anchor was not applied.");
  if (!patched.includes("buildStrictVideoContinuityInstruction")) throw new Error("Director strict video continuity was not applied.");
  return patched;
}
