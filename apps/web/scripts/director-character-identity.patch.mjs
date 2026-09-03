export function patchDirectorCharacterIdentity(source, replaceRequired) {
  let patched = source;

  const oldImport = 'import { buildApprovalReferenceImages, chooseApprovedShotSeed, resolveCharacterReferenceUrls } from "../lib/directorCharacterMedia.js";';
  const newImport = 'import { buildApprovalReferenceImages, buildCharacterIdentityInstruction, chooseApprovedShotSeed, resolveCharacterIdentities } from "../lib/directorCharacterMedia.js";';
  if (!patched.includes("buildCharacterIdentityInstruction")) {
    patched = replaceRequired(patched, oldImport, newImport, "Director character identity imports");
  }

  const oldCharacterOptions = '  const characterOptions = useMemo<CharacterOption[]>(() => { const options = characterReferences.map((reference) => ({ id: reference.id, name: reference.name, url: reference.anchorUrl ?? reference.url })); if (characterImageUrl && !options.some((option) => option.id === "store-character")) options.unshift({ id: "store-character", name: "Approved project character", url: characterImageUrl }); return options; }, [characterReferences, characterImageUrl]);';
  const newCharacterOptions = '  const characterOptions = useMemo<CharacterOption[]>(() => { const options = characterReferences.map((reference) => ({ id: reference.id, name: reference.name, url: reference.anchorUrl ?? reference.url })); if (characterImageUrl && !options.some((option) => option.url === characterImageUrl)) options.unshift({ id: "store-character", name: "Approved project character", url: characterImageUrl }); return options; }, [characterReferences, characterImageUrl]);';
  if (patched.includes(oldCharacterOptions)) patched = patched.replace(oldCharacterOptions, newCharacterOptions);

  const oldResolver = '  const selectedCharacterUrlsForShot = (shot: LtxShotPlan) => { const selectedIds = selectionForClip(session.characterSelections, shot.clipId, shot.conditioningReferenceId).filter((id) => session.approvedCharacterIds.includes(id)); return resolveCharacterReferenceUrls(selectedIds, characterReferences, characterImageUrl ?? null); };';
  const newResolver = '  const selectedCharactersForShot = (shot: LtxShotPlan) => { const selectedIds = selectionForClip(session.characterSelections, shot.clipId, shot.conditioningReferenceId).filter((id) => session.approvedCharacterIds.includes(id)); return resolveCharacterIdentities(selectedIds, characterReferences, characterImageUrl ?? null); };\n  const selectedCharacterUrlsForShot = (shot: LtxShotPlan) => selectedCharactersForShot(shot).map((identity) => identity.url);';
  if (!patched.includes("const selectedCharactersForShot")) {
    patched = replaceRequired(patched, oldResolver, newResolver, "Director selected character identity resolver");
  }

  const scenePrefixBeforeEditing = '{session.plan.shots.map((shot) => { const sceneApproval = session.sceneApprovals[shot.clipId]; const selectedCharacterUrls = selectedCharacterUrlsForShot(shot); const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); return';
  const scenePrefixAfterEditing = '{session.plan.shots.map((shot) => { const sceneApproval = session.sceneApprovals[shot.clipId]; const selectedCharacterUrls = selectedCharacterUrlsForShot(shot); const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const scenePendingEdit = session.pendingAssetEdits[assetEditKey("scene_image", shot.clipId)]; return';
  const newScenePrefixBeforeEditing = '{session.plan.shots.map((shot) => { const sceneApproval = session.sceneApprovals[shot.clipId]; const selectedCharacters = selectedCharactersForShot(shot); const selectedCharacterUrls = selectedCharacters.map((identity) => identity.url); const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const sceneIdentityInstruction = buildCharacterIdentityInstruction(selectedCharacters, sceneReferenceUrls); return';
  const newScenePrefixAfterEditing = '{session.plan.shots.map((shot) => { const sceneApproval = session.sceneApprovals[shot.clipId]; const selectedCharacters = selectedCharactersForShot(shot); const selectedCharacterUrls = selectedCharacters.map((identity) => identity.url); const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const sceneIdentityInstruction = buildCharacterIdentityInstruction(selectedCharacters, sceneReferenceUrls); const scenePendingEdit = session.pendingAssetEdits[assetEditKey("scene_image", shot.clipId)]; return';
  if (!patched.includes("const sceneIdentityInstruction")) {
    if (patched.includes(scenePrefixAfterEditing)) patched = patched.replace(scenePrefixAfterEditing, newScenePrefixAfterEditing);
    else patched = replaceRequired(patched, scenePrefixBeforeEditing, newScenePrefixBeforeEditing, "Director scene character identity binding");
  }

  const oldSceneCall = 'generateSceneVisual(shot.clipId, `Cinematic scene board for ${shot.sectionLabel}. ${session.plan!.treatment.visualStyle}. ${session.plan!.treatment.colorPalette}. ${shot.prompt}. Continuity: ${shot.continuityNotes}.`, sceneReferenceUrls)';
  const newSceneCall = 'generateSceneVisual(shot.clipId, `Cinematic scene board for ${shot.sectionLabel}. ${session.plan!.treatment.visualStyle}. ${session.plan!.treatment.colorPalette}. ${shot.prompt}. Continuity: ${shot.continuityNotes}. ${sceneIdentityInstruction}`, sceneReferenceUrls)';
  if (patched.includes(oldSceneCall)) patched = patched.replace(oldSceneCall, newSceneCall);

  const shotPrefixBeforeEditing = '{session.plan.shots.map((shot) => { const promptWords = words(shot.prompt); const selectedCharacterUrls = selectedCharacterUrlsForShot(shot); const conditioningReady = !shot.requiresCharacter || selectedCharacterUrls.length > 0; const shotApproval = session.shotApprovals[shot.clipId]; const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); return';
  const shotPrefixAfterEditing = '{session.plan.shots.map((shot) => { const promptWords = words(shot.prompt); const selectedCharacterUrls = selectedCharacterUrlsForShot(shot); const conditioningReady = !shot.requiresCharacter || selectedCharacterUrls.length > 0; const shotApproval = session.shotApprovals[shot.clipId]; const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const shotPendingEdit = session.pendingAssetEdits[assetEditKey("shot_image", shot.clipId)]; return';
  const newShotPrefixBeforeEditing = '{session.plan.shots.map((shot) => { const promptWords = words(shot.prompt); const selectedCharacters = selectedCharactersForShot(shot); const selectedCharacterUrls = selectedCharacters.map((identity) => identity.url); const conditioningReady = !shot.requiresCharacter || selectedCharacterUrls.length > 0; const shotApproval = session.shotApprovals[shot.clipId]; const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const shotIdentityInstruction = buildCharacterIdentityInstruction(selectedCharacters, shotReferenceUrls); return';
  const newShotPrefixAfterEditing = '{session.plan.shots.map((shot) => { const promptWords = words(shot.prompt); const selectedCharacters = selectedCharactersForShot(shot); const selectedCharacterUrls = selectedCharacters.map((identity) => identity.url); const conditioningReady = !shot.requiresCharacter || selectedCharacterUrls.length > 0; const shotApproval = session.shotApprovals[shot.clipId]; const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const shotIdentityInstruction = buildCharacterIdentityInstruction(selectedCharacters, shotReferenceUrls); const shotPendingEdit = session.pendingAssetEdits[assetEditKey("shot_image", shot.clipId)]; return';
  if (!patched.includes("const shotIdentityInstruction")) {
    if (patched.includes(shotPrefixAfterEditing)) patched = patched.replace(shotPrefixAfterEditing, newShotPrefixAfterEditing);
    else patched = replaceRequired(patched, shotPrefixBeforeEditing, newShotPrefixBeforeEditing, "Director shot character identity binding");
  }

  const oldShotCall = 'generateShotVisual(shot.clipId, `${shot.prompt}. Continuity: ${shot.continuityNotes}. Transition: ${shot.transition}.`, shotReferenceUrls)';
  const newShotCall = 'generateShotVisual(shot.clipId, `${shot.prompt}. Continuity: ${shot.continuityNotes}. Transition: ${shot.transition}. ${shotIdentityInstruction}`, shotReferenceUrls)';
  if (patched.includes(oldShotCall)) patched = patched.replace(oldShotCall, newShotCall);

  const preparedOld = `    const selectedCharacterUrls = selectedCharacterUrlsForShot(shot);\n    const existingUrl = targetType === "scene_image" ? session.sceneApprovals[clipId]?.url : session.shotApprovals[clipId]?.url;\n    const referenceUrls = buildApprovalReferenceImages(existingUrl, selectedCharacterUrls).map((reference) => reference.uri);\n    if (targetType === "scene_image") await generateSceneVisual(clipId, pending.prompt, referenceUrls);\n    else await generateShotVisual(clipId, pending.prompt, referenceUrls);`;
  const preparedNew = `    const preparedCharacters = selectedCharactersForShot(shot);\n    const selectedCharacterUrls = preparedCharacters.map((identity) => identity.url);\n    const existingUrl = targetType === "scene_image" ? session.sceneApprovals[clipId]?.url : session.shotApprovals[clipId]?.url;\n    const referenceUrls = buildApprovalReferenceImages(existingUrl, selectedCharacterUrls).map((reference) => reference.uri);\n    const preparedIdentityInstruction = buildCharacterIdentityInstruction(preparedCharacters, referenceUrls);\n    const preparedPrompt = [pending.prompt, preparedIdentityInstruction].filter(Boolean).join(" ");\n    if (targetType === "scene_image") await generateSceneVisual(clipId, preparedPrompt, referenceUrls);\n    else await generateShotVisual(clipId, preparedPrompt, referenceUrls);`;
  if (patched.includes("const generatePreparedImage") && !patched.includes("const preparedIdentityInstruction")) {
    patched = replaceRequired(patched, preparedOld, preparedNew, "Director prepared-image character identity binding");
  }

  return patched;
}
