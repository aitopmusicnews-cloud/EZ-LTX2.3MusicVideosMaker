export function patchDirectorChat(source, replaceRequired) {
  let patched = source;

  const apiImport = 'import { startTextToImage, pollTask, saveImageToLibrary } from "../lib/api.js";';
  const chatImport = `import { startTextToImage, pollTask, saveImageToLibrary, saveClipToServer, startDirectorSectionRender } from "../lib/api.js";\nimport { DirectorEditChat, type DirectorEditAction } from "./DirectorEditChat.js";\nimport { DirectorSectionReview } from "./DirectorSectionReview.js";\nimport { DirectorAssetsPanel } from "./DirectorAssetsPanel.js";`;
  if (!patched.includes('from "./DirectorEditChat.js"')) {
    patched = replaceRequired(patched, apiImport, chatImport, "Director edit chat import");
  }

  const createPlanAnchor = `  const createPlan = async () => {`;
  const workflowHelpers = `  const generateSectionPreview = async (clipId: string) => {
    const plan = session.plan;
    const shot = plan?.shots.find((item) => item.clipId === clipId);
    const timelineClips = useStore.getState().clips;
    const clip = timelineClips.find((item) => item.id === clipId);
    if (!plan || !shot || !clip) { setError(\`Could not find section \${clipId} on the timeline.\`); return; }
    if (!session.treatmentApproved) { setError("Approve the treatment before spending video credits on a section."); return; }
    if (!session.sceneApprovals[clipId]?.approved) { setError(\`Approve the scene image for \${shot.sectionLabel} before generating video.\`); return; }
    const approvedShot = session.shotApprovals[clipId];
    if (!approvedShot?.approved || !approvedShot.url) { setError(\`Approve the shot image for \${shot.sectionLabel} before generating video.\`); return; }
    if (clip.status === "queued" || clip.status === "generating") { setError(\`\${shot.sectionLabel} is already generating. Keep chatting with Director while it finishes, then review it on the timeline.\`); return; }
    const conditioningUrl = approvedShot.url || resolveReferenceUrl(shot.conditioningReferenceId) || undefined;
    if (shot.requiresCharacter && !conditioningUrl) { setError(\`\${shot.sectionLabel} needs an approved shot image or character asset before video generation.\`); return; }
    const anotherActive = timelineClips.some((item) => item.id !== clipId && (item.status === "queued" || item.status === "generating"));
    if (anotherActive) { setError("Another Director section is already generating. Finish and review it before starting another."); return; }

    const characterDirection = [
      plan.characterBible.referenceSummary,
      plan.characterBible.immutableTraits.join(", "),
      plan.characterBible.wardrobe,
      plan.characterBible.prohibitedChanges.length ? \`Do not change: \${plan.characterBible.prohibitedChanges.join(", ")}\` : "",
    ].filter(Boolean).join(". ");
    const globalPrompt = [
      plan.treatment.logline,
      \`Visual style: \${plan.treatment.visualStyle}\`,
      \`Color palette: \${plan.treatment.colorPalette}\`,
      \`Camera language: \${plan.treatment.cameraLanguage}\`,
      \`Continuity: \${plan.treatment.continuityStrategy}\`,
      characterDirection,
    ].filter(Boolean).join(". ");

    setError(null);
    updateClip(clip.id, {
      prompt: shot.prompt,
      sectionLabel: shot.sectionLabel,
      seedImageUrl: conditioningUrl,
      archetypeUrl: conditioningUrl,
      source: "imageToVideo",
      model: "ltx-director",
      status: "generating",
      videoUrl: undefined,
      lastError: undefined,
    });

    try {
      const task = await startDirectorSectionRender({
        projectId: useStore.getState().projectId ?? "director",
        clipId: clip.id,
        sectionLabel: shot.sectionLabel,
        globalPrompt,
        prompt: shot.prompt,
        duration: clip.end - clip.start,
        conditioningImageUrl: conditioningUrl,
        requiresCharacter: shot.requiresCharacter,
        fps: 24,
      });
      updateClip(clip.id, { generationTaskId: task.id });
      toast.success(\`LTXDirector is rendering only \${shot.sectionLabel} from its approved shot image. You can keep chatting while it renders.\`);

      const final = await pollTask(task.id, 5000, 1_800_000);
      const videoUrl = final.outputUrl || (Array.isArray(final.output) ? final.output[0] : final.output?.videoUrl ?? final.output?.url);
      if ((final.status || "").toUpperCase() !== "SUCCEEDED" || !videoUrl) {
        throw new Error(final.error ?? \`Director task ended in \${final.status} with no video.\`);
      }

      updateClip(clip.id, { videoUrl, status: "ready", model: "ltx-director", lastError: undefined });
      void saveClipToServer({
        id: clip.id,
        name: shot.prompt.slice(0, 60) || \`\${shot.sectionLabel} Director section\`,
        videoUrl,
        source: "imageToVideo",
        prompt: shot.prompt,
        duration: clip.end - clip.start,
        sectionLabel: shot.sectionLabel,
        model: "ltx-director",
        generationTaskId: task.id,
      }).catch((failure) => console.warn("Director section auto-save failed", failure));
      toast.success(\`\${shot.sectionLabel} is on the timeline and ready to preview. Approve it before moving on.\`);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      updateClip(clip.id, { status: "failed", lastError: message });
      setError(message);
      toast.error(\`LTX Director section failed: \${message.slice(0, 120)}\`);
    }
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
          model: "ltx-director",
        });

        if (action.regenerate) {
          if (busy) {
            toast.success(\`Director saved the change for \${action.clipId}. Finish the current approval-image render, then regenerate this shot.\`);
          } else {
            const visualChanged = action.prompt !== undefined || action.continuityNotes !== undefined || action.transition !== undefined || action.requiresCharacter !== undefined || action.conditioningReferenceId !== undefined;
            if (visualChanged) {
              const imagePrompt = \`\${nextShot.prompt}. Continuity: \${nextShot.continuityNotes}. Transition: \${nextShot.transition}.\`;
              await generateShotVisual(action.clipId, imagePrompt, conditioningUrl || characterImageUrl || undefined);
              toast.success(\`Director updated \${action.clipId} and made a new shot image. Approve that image before regenerating video.\`);
            } else {
              await generateSectionPreview(action.clipId);
            }
          }
        } else {
          toast.success(\`Director updated \${action.clipId}\`);
        }
        continue;
      }

      if (busy) {
        toast.success(\`Director understood the image edit for \${action.clipId}. Finish the current image render, then send/regenerate that image edit so we never overlap generation jobs.\`);
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
    if (!patched.includes(createPlanAnchor)) throw new Error("Could not find Director createPlan insertion anchor.");
    patched = patched.replace(createPlanAnchor, workflowHelpers + createPlanAnchor);
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
          disabled={false}
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
