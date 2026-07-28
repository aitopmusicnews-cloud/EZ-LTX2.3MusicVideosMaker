export function patchDirectorChat(source, replaceRequired) {
  let patched = source;

  const apiImport = 'import { startTextToImage, pollTask, saveImageToLibrary } from "../lib/api.js";';
  const chatImport = `import { startTextToImage, pollTask, saveImageToLibrary, saveClipToServer, startDirectorSectionRender } from "../lib/api.js";\nimport { DirectorEditChat, type DirectorEditAction } from "./DirectorEditChat.js";\nimport { DirectorSectionReview } from "./DirectorSectionReview.js";\nimport { DirectorAssetsPanel } from "./DirectorAssetsPanel.js";`;
  if (!patched.includes('from "./DirectorEditChat.js"')) {
    patched = replaceRequired(patched, apiImport, chatImport, "Director edit chat import");
  }

  const visualHelpersAnchor = `  const generateShotVisual = async (key: string, prompt: string, referenceUrl?: string) => {
    setError(null); setBusy(\`Generating shot image for \${key}\`);
    try { const url = await generateApprovalImage(prompt, referenceUrl); setShotApproval(key, { url, approved: false }); toast.success("Shot image generated for approval"); } catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); toast.error(\`Shot image generation failed: \${message}\`); } finally { setBusy(null); }
  };
 `;

  const workflowHelpers = `${visualHelpersAnchor}
  const generateSectionPreview = async (clipId: string) => {
    const plan = session.plan;
    const shot = plan?.shots.find((item) => item.clipId === clipId);
    const timelineClips = useStore.getState().clips;
    const clip = timelineClips.find((item) => item.id === clipId);
    if (!plan || !shot || !clip) { setError(\`Could not find section \${clipId} on the timeline.\`); return; }
    if (!session.treatmentApproved) { setError("Approve the treatment before spending video credits on a section."); return; }
    if (!session.sceneApprovals[clipId]?.approved) { setError(\`Approve the scene image for \${shot.sectionLabel} before generating video.\`); return; }
    if (!session.shotApprovals[clipId]?.approved) { setError(\`Approve the shot image for \${shot.sectionLabel} before generating video.\`); return; }
    const conditioningUrl = resolveReferenceUrl(shot.conditioningReferenceId) || undefined;
    if (shot.requiresCharacter && !conditioningUrl) { setError(\`\${shot.sectionLabel} needs a character asset before video generation.\`); return; }
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
      source: conditioningUrl ? "imageToVideo" : "textToVideo",
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
      toast.success(\`LTXDirector is producing only \${shot.sectionLabel}. Review it before moving on.\`);

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
        source: conditioningUrl ? "imageToVideo" : "textToVideo",
        prompt: shot.prompt,
        duration: clip.end - clip.start,
        sectionLabel: shot.sectionLabel,
        model: "ltx-director",
        generationTaskId: task.id,
      }).catch((failure) => console.warn("Director section auto-save failed", failure));
      toast.success(\`\${shot.sectionLabel} is ready to watch and approve.\`);
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
          const visualChanged = action.prompt !== undefined || action.continuityNotes !== undefined || action.transition !== undefined || action.requiresCharacter !== undefined || action.conditioningReferenceId !== undefined;
          if (visualChanged) {
            const imagePrompt = \`\${nextShot.prompt}. Continuity: \${nextShot.continuityNotes}. Transition: \${nextShot.transition}.\`;
            await generateShotVisual(action.clipId, imagePrompt, conditioningUrl || characterImageUrl || undefined);
            toast.success(\`Director updated \${action.clipId} and made a new shot image. Approve that image before regenerating video.\`);
          } else {
            await generateSectionPreview(action.clipId);
          }
        } else {
          toast.success(\`Director updated \${action.clipId}\`);
        }
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
    patched = replaceRequired(patched, visualHelpersAnchor, workflowHelpers, "Director native LTX section preview and chat action handlers");
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
