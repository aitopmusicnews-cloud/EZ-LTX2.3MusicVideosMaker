export function patchDirectorChat(source, replaceRequired) {
  let patched = source;

  const apiImport = 'import { startTextToImage, pollTask, saveImageToLibrary } from "../lib/api.js";';
  const chatImport = `${apiImport}\nimport { DirectorEditChat, type DirectorEditAction } from "./DirectorEditChat.js";\nimport { DirectorSectionReview } from "./DirectorSectionReview.js";\nimport { DirectorAssetsPanel } from "./DirectorAssetsPanel.js";`;
  if (!patched.includes('from "./DirectorEditChat.js"')) {
    patched = replaceRequired(patched, apiImport, chatImport, "Director edit chat import");
  }

  const visualHelpersAnchor = `  const generateShotVisual = async (key: string, prompt: string, referenceUrl?: string) => {
    setError(null); setBusy(\`Generating shot image for \${key}\`);
    try { const url = await generateApprovalImage(prompt, referenceUrl); setShotApproval(key, { url, approved: false }); toast.success("Shot image generated for approval"); } catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); toast.error(\`Shot image generation failed: \${message}\`); } finally { setBusy(null); }
  };
`;

  const workflowHelpers = `${visualHelpersAnchor}
  const generateSectionPreview = (clipId: string) => {
    const shot = session.plan?.shots.find((item) => item.clipId === clipId);
    const timelineClips = useStore.getState().clips;
    const clipIndex = timelineClips.findIndex((item) => item.id === clipId);
    const clip = clipIndex >= 0 ? timelineClips[clipIndex] : undefined;
    if (!shot || !clip) { setError(\`Could not find section \${clipId} on the timeline.\`); return; }
    const conditioningUrl = resolveReferenceUrl(shot.conditioningReferenceId) || undefined;
    if (shot.requiresCharacter && !conditioningUrl) { setError(\`\${shot.sectionLabel} needs a character asset before video generation.\`); return; }
    const previousReady = clipIndex > 0 && timelineClips[clipIndex - 1]?.status === "ready" && Boolean(timelineClips[clipIndex - 1]?.videoUrl);
    const source = conditioningUrl ? "imageToVideo" : previousReady ? "continue" : "textToVideo";
    updateClip(clip.id, {
      prompt: shot.prompt,
      sectionLabel: shot.sectionLabel,
      seedImageUrl: conditioningUrl,
      archetypeUrl: conditioningUrl,
      source,
      model: "ltx-video",
      lastError: undefined,
    });
    (enqueueGeneration as any)({
      clipId: clip.id,
      source,
      seedImageUrl: conditioningUrl || "",
      requiresCharacter: shot.requiresCharacter,
      prompt: shot.prompt,
      duration: clip.end - clip.start,
      sectionLabel: shot.sectionLabel,
      energy: 0.65,
      model: "ltx-video",
    });
    toast.success(\`Generating only \${shot.sectionLabel}. Review and approve it before moving on.\`);
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
        updateShot(action.clipId, patch);

        const conditioningUrl = resolveReferenceUrl(nextShot.conditioningReferenceId);
        updateClip(action.clipId, {
          prompt: nextShot.prompt,
          sectionLabel: nextShot.sectionLabel,
          seedImageUrl: conditioningUrl || undefined,
          archetypeUrl: conditioningUrl || undefined,
          source: conditioningUrl ? "imageToVideo" : "textToVideo",
          model: "ltx-video",
        });

        if (action.regenerate) {
          const clip = useStore.getState().clips.find((item) => item.id === action.clipId);
          if (clip) {
            const clipIndex = useStore.getState().clips.findIndex((item) => item.id === action.clipId);
            const previousReady = clipIndex > 0 && useStore.getState().clips[clipIndex - 1]?.status === "ready" && Boolean(useStore.getState().clips[clipIndex - 1]?.videoUrl);
            const source = conditioningUrl ? "imageToVideo" : previousReady ? "continue" : "textToVideo";
            (enqueueGeneration as any)({
              clipId: clip.id,
              source,
              seedImageUrl: conditioningUrl || "",
              requiresCharacter: nextShot.requiresCharacter,
              prompt: nextShot.prompt,
              duration: clip.end - clip.start,
              sectionLabel: nextShot.sectionLabel,
              energy: 0.65,
              model: "ltx-video",
            });
          }
        }
        toast.success(action.regenerate ? \`Director updated and requeued \${action.clipId}\` : \`Director updated \${action.clipId}\`);
        continue;
      }

      const existingImage = action.type === "edit_scene_image"
        ? session.sceneApprovals[action.clipId]?.url
        : session.shotApprovals[action.clipId]?.url;
      const referenceUrl = existingImage || resolveReferenceUrl(currentShot.conditioningReferenceId) || characterImageUrl || undefined;
      if (action.type === "edit_scene_image") await generateSceneVisual(action.clipId, action.prompt, referenceUrl);
      else await generateShotVisual(action.clipId, action.prompt, referenceUrl);
    }
  };
`;

  if (!patched.includes("const generateSectionPreview =")) {
    patched = replaceRequired(patched, visualHelpersAnchor, workflowHelpers, "Director section preview and chat action handlers");
  }

  const assetStrip = `      <div style={assetStripStyle}><div><strong>{characterImageUrl || characterReferences.length ? "Character conditioning ready" : "No character conditioning"}</strong><div style={smallStyle}>{characterReferences.length} uploaded character reference{characterReferences.length === 1 ? "" : "s"} · {readyReferences.length} total inputs</div></div><button type="button" className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-reference-chat"))}>Use ＋ References</button></div>`;
  const workflowPanel = `${assetStrip}
      {session.plan && <>
        <DirectorAssetsPanel
          references={readyReferences.map((reference) => ({ id: reference.id, kind: reference.kind, media: reference.media, name: reference.name, url: reference.url, anchorUrl: reference.anchorUrl ?? (reference.media === "image" ? reference.url : undefined), note: reference.note }))}
          sceneImages={Object.fromEntries(Object.entries(session.sceneApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))}
          shotImages={Object.fromEntries(Object.entries(session.shotApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))}
        />
        <DirectorEditChat
          plan={session.plan}
          references={readyReferences.map((reference) => ({ id: reference.id, kind: reference.kind, media: reference.media, name: reference.name, note: reference.note, anchorUrl: reference.anchorUrl ?? (reference.media === "image" ? reference.url : undefined) }))}
          sceneImages={Object.fromEntries(Object.entries(session.sceneApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))}
          shotImages={Object.fromEntries(Object.entries(session.shotApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))}
          disabled={!!busy}
          onApply={applyDirectorChatActions}
        />
        <DirectorSectionReview songId={songId} plan={session.plan} disabled={!!busy} onGenerate={generateSectionPreview} />
      </>}`;
  if (!patched.includes("DirectorSectionReview songId")) {
    patched = replaceRequired(patched, assetStrip, workflowPanel, "Director assets, chat, and section approval panels");
  }

  const startMarker = " onClick={startProduction}>";
  const startMarkerIndex = patched.indexOf(startMarker);
  if (startMarkerIndex >= 0) {
    const buttonStart = patched.lastIndexOf('<button type="button"', startMarkerIndex);
    const buttonEnd = patched.indexOf("</button>", startMarkerIndex);
    if (buttonStart < 0 || buttonEnd < 0) throw new Error("Could not replace bulk Director production button.");
    patched = patched.slice(0, buttonStart) + `<button type="button" className="btn" disabled title="Credit protection: generate and approve one section at a time above.">Section-by-section generation enabled</button>` + patched.slice(buttonEnd + "</button>".length);
  }
  if (patched.includes(startMarker)) throw new Error("Bulk Director production button is still enabled.");

  const bulkRetry = `{clipProgress.failed > 0 && <button type="button" className="btn" onClick={retryFailed}>Retry failed clips</button>}`;
  if (patched.includes(bulkRetry)) patched = patched.replace(bulkRetry, "");

  return patched;
}
