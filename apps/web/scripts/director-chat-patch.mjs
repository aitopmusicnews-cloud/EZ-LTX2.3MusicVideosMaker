export function patchDirectorChat(source, replaceRequired) {
  let patched = source;

  const apiImport = 'import { startTextToImage, pollTask, saveImageToLibrary } from "../lib/api.js";';
  const chatImport = `${apiImport}\nimport { DirectorEditChat, type DirectorEditAction } from "./DirectorEditChat.js";`;
  if (!patched.includes('from "./DirectorEditChat.js"')) {
    patched = replaceRequired(patched, apiImport, chatImport, "Director edit chat import");
  }

  const visualHelpersAnchor = `  const generateShotVisual = async (key: string, prompt: string, referenceUrl?: string) => {
    setError(null); setBusy(\`Generating shot image for \${key}\`);
    try { const url = await generateApprovalImage(prompt, referenceUrl); setShotApproval(key, { url, approved: false }); toast.success("Shot image generated for approval"); } catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); toast.error(\`Shot image generation failed: \${message}\`); } finally { setBusy(null); }
  };
`;

  const chatActionHelpers = `${visualHelpersAnchor}
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
            (enqueueGeneration as any)({
              clipId: clip.id,
              source: conditioningUrl ? "imageToVideo" : "textToVideo",
              seedImageUrl: conditioningUrl,
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

  if (!patched.includes("const applyDirectorChatActions = async")) {
    patched = replaceRequired(patched, visualHelpersAnchor, chatActionHelpers, "Director chat action handler");
  }

  const assetStrip = `      <div style={assetStripStyle}><div><strong>{characterImageUrl || characterReferences.length ? "Character conditioning ready" : "No character conditioning"}</strong><div style={smallStyle}>{characterReferences.length} uploaded character reference{characterReferences.length === 1 ? "" : "s"} · {readyReferences.length} total inputs</div></div><button type="button" className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-reference-chat"))}>Use ＋ References</button></div>`;
  const chatPanel = `${assetStrip}
      {session.plan && <DirectorEditChat
        plan={session.plan}
        references={readyReferences.map((reference) => ({ id: reference.id, kind: reference.kind, name: reference.name, note: reference.note, anchorUrl: reference.anchorUrl ?? (reference.media === "image" ? reference.url : undefined) }))}
        sceneImages={Object.fromEntries(Object.entries(session.sceneApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))}
        shotImages={Object.fromEntries(Object.entries(session.shotApprovals).filter(([, value]) => Boolean(value?.url)).map(([key, value]) => [key, value.url]))}
        disabled={!!busy}
        onApply={applyDirectorChatActions}
      />}`;
  if (!patched.includes("Director chat — adjust clips & images")) {
    patched = replaceRequired(patched, assetStrip, chatPanel, "Director chat panel");
  }

  return patched;
}
