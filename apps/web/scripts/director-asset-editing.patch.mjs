function replaceTag(source, tagName, replacement) {
  const start = source.indexOf(`<${tagName}`);
  if (start < 0) throw new Error(`Could not find ${tagName} usage.`);
  const end = source.indexOf("/>", start);
  if (end < 0) throw new Error(`Could not find closing ${tagName} tag.`);
  return source.slice(0, start) + replacement + source.slice(end + 2);
}

export function patchDirectorAssetEditing(source, replaceRequired) {
  let patched = source;

  const stateImport = 'import { migrateDirectorCharacterState, sanitizeCharacterSelections, selectionForClip, toggleApprovedCharacter } from "../lib/directorCharacterState.js";';
  const stateImportWithSelection = 'import { migrateDirectorCharacterState, sanitizeCharacterSelections, selectionForClip, setClipCharacterSelection, toggleApprovedCharacter } from "../lib/directorCharacterState.js";';
  if (!patched.includes("setClipCharacterSelection")) patched = replaceRequired(patched, stateImport, stateImportWithSelection, "Director per-asset character selection import");

  const characterImport = 'import { DirectorCharacterApproval, type CharacterOption } from "./DirectorCharacterControls.js";';
  const editingImports = 'import { DirectorCharacterApproval, DirectorCharacterPicker, type CharacterOption } from "./DirectorCharacterControls.js";\nimport { AssetEditChat } from "./AssetEditChat.js";';
  if (!patched.includes('import { AssetEditChat }')) patched = replaceRequired(patched, characterImport, editingImports, "Director inline asset editing imports");

  const handlerStart = patched.indexOf("  const applyDirectorChatActions = async");
  const handlerEnd = patched.indexOf("\n  const createPlan = async", handlerStart);
  if (handlerStart < 0 || handlerEnd < 0) throw new Error("Could not isolate Director chat action handler.");

  const preparedHandler = `  const updateCharacterSelection = (clipId: string, ids: string[]) => setSession((current) => {
    const characterSelections = setClipCharacterSelection(current.characterSelections, clipId, ids, current.approvedCharacterIds);
    const sceneApprovals = current.sceneApprovals[clipId]
      ? { ...current.sceneApprovals, [clipId]: { ...current.sceneApprovals[clipId], approved: false } }
      : current.sceneApprovals;
    const shotApprovals = current.shotApprovals[clipId]
      ? { ...current.shotApprovals, [clipId]: { ...current.shotApprovals[clipId], approved: false } }
      : current.shotApprovals;
    return { ...current, characterSelections, sceneApprovals, shotApprovals, planAccepted: false };
  });

  const clearPendingAssetEdit = (targetType: "scene_image" | "shot_image" | "clip", clipId: string) => setSession((current) => {
    const key = assetEditKey(targetType, clipId);
    if (!current.pendingAssetEdits[key]) return current;
    const pendingAssetEdits = { ...current.pendingAssetEdits };
    delete pendingAssetEdits[key];
    return { ...current, pendingAssetEdits };
  });

  const generatePreparedImage = async (targetType: "scene_image" | "shot_image", clipId: string) => {
    const shot = session.plan?.shots.find((item) => item.clipId === clipId);
    const pending = session.pendingAssetEdits[assetEditKey(targetType, clipId)];
    if (!shot || !pending?.prompt) { toast.error("No prepared image edit is waiting for this asset."); return; }
    const selectedCharacterUrls = selectedCharacterUrlsForShot(shot);
    const existingUrl = targetType === "scene_image" ? session.sceneApprovals[clipId]?.url : session.shotApprovals[clipId]?.url;
    const referenceUrls = buildApprovalReferenceImages(existingUrl, selectedCharacterUrls).map((reference) => reference.uri);
    if (targetType === "scene_image") await generateSceneVisual(clipId, pending.prompt, referenceUrls);
    else await generateShotVisual(clipId, pending.prompt, referenceUrls);
    clearPendingAssetEdit(targetType, clipId);
  };

  const applyDirectorChatActions = async (actions: DirectorEditAction[]) => {
    if (!session.plan) return;
    for (const action of actions) {
      const currentShot = session.plan.shots.find((shot) => shot.clipId === action.clipId);
      if (!currentShot) continue;

      if (action.type === "update_clip") {
        const patch: Partial<LtxShotPlan> = {};
        if (action.prompt !== undefined) patch.prompt = action.prompt;
        if (action.continuityNotes !== undefined) patch.continuityNotes = action.continuityNotes;
        if (action.transition !== undefined) patch.transition = action.transition;
        if (action.sectionLabel !== undefined) patch.sectionLabel = action.sectionLabel;
        if (action.requiresCharacter !== undefined) patch.requiresCharacter = action.requiresCharacter;
        if (action.conditioningReferenceId !== undefined) patch.conditioningReferenceId = action.conditioningReferenceId;
        const nextShot = { ...currentShot, ...patch };
        if (Object.keys(patch).length) updateShot(action.clipId, patch);
        updateClip(action.clipId, { prompt: nextShot.prompt, sectionLabel: nextShot.sectionLabel });
        if (action.regenerate) {
          setSession((current) => ({ ...current, pendingAssetEdits: { ...current.pendingAssetEdits, [assetEditKey("clip", action.clipId)]: { targetType: "clip", clipId: action.clipId, regenerate: true } } }));
          toast.success(`Director prepared ${action.clipId} for regeneration. Press Regenerate when ready.`);
        } else {
          toast.success(`Director updated ${action.clipId}. No media was regenerated.`);
        }
        continue;
      }

      const targetType = action.type === "edit_scene_image" ? "scene_image" : "shot_image";
      setSession((current) => ({ ...current, pendingAssetEdits: { ...current.pendingAssetEdits, [assetEditKey(targetType, action.clipId)]: { targetType, clipId: action.clipId, prompt: action.prompt } } }));
      toast.success(`Director prepared the ${targetType === "scene_image" ? "scene" : "shot"} image edit. Press Generate edited image when ready.`);
    }
  };
`;
  patched = patched.slice(0, handlerStart) + preparedHandler + patched.slice(handlerEnd);

  const sectionToast = '    toast.success(`Generating only ${shot.sectionLabel}. Review and approve it before moving on.`);';
  const sectionToastWithClear = '    clearPendingAssetEdit("clip", clipId);\n    toast.success(`Generating only ${shot.sectionLabel}. Review and approve it before moving on.`);';
  if (!patched.includes('clearPendingAssetEdit("clip", clipId)')) patched = replaceRequired(patched, sectionToast, sectionToastWithClear, "explicit section regeneration pending-edit clear");

  const scenePrefix = 'const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); return';
  const scenePrefixWithPending = 'const sceneReferenceUrls = buildApprovalReferenceImages(sceneApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const scenePendingEdit = session.pendingAssetEdits[assetEditKey("scene_image", shot.clipId)]; return';
  if (!patched.includes("const scenePendingEdit")) patched = replaceRequired(patched, scenePrefix, scenePrefixWithPending, "scene pending edit state");

  const sceneTail = '</div></div></article>; })}</div></section>';
  const sceneInline = `</div></div><DirectorCharacterPicker characters={characterOptions} approvedIds={session.approvedCharacterIds} selectedIds={selectionForClip(session.characterSelections, shot.clipId, shot.conditioningReferenceId).filter((id) => session.approvedCharacterIds.includes(id))} onChange={(ids) => updateCharacterSelection(shot.clipId, ids)} disabled={!!busy} /><AssetEditChat label={\`Edit \${shot.sectionLabel} scene\`} target={{ type: "scene_image", clipId: shot.clipId }} plan={session.plan} references={readyReferences} sceneImages={Object.fromEntries(Object.entries(session.sceneApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))} shotImages={Object.fromEntries(Object.entries(session.shotApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))} disabled={!!busy} onApply={applyDirectorChatActions} />{scenePendingEdit?.prompt && <div style={approvalActionsStyle}><span style={approvalStatusStyle}>Director edit prepared · no image credits spent yet</span><button type="button" className="btn primary" disabled={!!busy} onClick={() => void generatePreparedImage("scene_image", shot.clipId)}>Generate edited image</button></div>}</article>; })}</div></section>`;
  if (!patched.includes('target={{ type: "scene_image", clipId: shot.clipId }}')) patched = replaceRequired(patched, sceneTail, sceneInline, "inline scene edit chat");

  const shotPrefix = 'const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); return';
  const shotPrefixWithPending = 'const shotReferenceUrls = buildApprovalReferenceImages(shotApproval?.url, selectedCharacterUrls).map((reference) => reference.uri); const shotPendingEdit = session.pendingAssetEdits[assetEditKey("shot_image", shot.clipId)]; return';
  if (!patched.includes("const shotPendingEdit")) patched = replaceRequired(patched, shotPrefix, shotPrefixWithPending, "shot pending edit state");

  const shotApprovalEnd = '</button>}</div></div><Field label="Section label"';
  const shotInline = `</button>}</div></div><DirectorCharacterPicker characters={characterOptions} approvedIds={session.approvedCharacterIds} selectedIds={selectionForClip(session.characterSelections, shot.clipId, shot.conditioningReferenceId).filter((id) => session.approvedCharacterIds.includes(id))} onChange={(ids) => updateCharacterSelection(shot.clipId, ids)} disabled={!!busy} /><AssetEditChat label={\`Edit \${shot.sectionLabel} shot\`} target={{ type: "shot_image", clipId: shot.clipId }} plan={session.plan} references={readyReferences} sceneImages={Object.fromEntries(Object.entries(session.sceneApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))} shotImages={Object.fromEntries(Object.entries(session.shotApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))} disabled={!!busy} onApply={applyDirectorChatActions} />{shotPendingEdit?.prompt && <div style={approvalActionsStyle}><span style={approvalStatusStyle}>Director edit prepared · no image credits spent yet</span><button type="button" className="btn primary" disabled={!!busy} onClick={() => void generatePreparedImage("shot_image", shot.clipId)}>Generate edited image</button></div>}<Field label="Section label"`;
  if (!patched.includes('target={{ type: "shot_image", clipId: shot.clipId }}')) patched = replaceRequired(patched, shotApprovalEnd, shotInline, "inline shot edit chat");

  const sharedImageMaps = `sceneImages={Object.fromEntries(Object.entries(session.sceneApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))} shotImages={Object.fromEntries(Object.entries(session.shotApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))}`;
  const assetsPanel = `<DirectorAssetsPanel plan={session.plan} references={readyReferences} ${sharedImageMaps} characters={characterOptions} approvedCharacterIds={session.approvedCharacterIds} characterSelections={session.characterSelections} pendingAssetEdits={session.pendingAssetEdits} disabled={!!busy} onApply={applyDirectorChatActions} onCharacterSelectionChange={updateCharacterSelection} onGeneratePreparedImage={generatePreparedImage} />`;
  patched = replaceTag(patched, "DirectorAssetsPanel", assetsPanel);

  const sectionReview = `<DirectorSectionReview songId={songId} plan={session.plan} references={readyReferences} ${sharedImageMaps} characters={characterOptions} approvedCharacterIds={session.approvedCharacterIds} characterSelections={session.characterSelections} pendingAssetEdits={session.pendingAssetEdits} disabled={!!busy} onGenerate={generateSectionPreview} onApply={applyDirectorChatActions} onCharacterSelectionChange={updateCharacterSelection} />`;
  patched = replaceTag(patched, "DirectorSectionReview", sectionReview);

  if (/if \(action\.regenerate\)[\s\S]{0,800}generateSectionPreview\(action\.clipId\)/.test(patched)) throw new Error("Director chat still auto-regenerates video.");
  if (/action\.type === "edit_scene_image"[\s\S]{0,800}await generateSceneVisual/.test(patched)) throw new Error("Director chat still auto-generates scene images.");
  if (/action\.type === "edit_shot_image"[\s\S]{0,800}await generateShotVisual/.test(patched)) throw new Error("Director chat still auto-generates shot images.");

  return patched;
}
