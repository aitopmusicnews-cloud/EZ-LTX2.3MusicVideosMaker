export function patchLeftRailTools(source, replaceRequired) {
  if (source.includes('mvs-open-ltx-director') && source.includes('mvs-open-promo-cut')) return source;

  const referenceSection = `      <div className="section">\n        <div className="section-header">\n          <span className="label">Reference images</span>`;
  const toolsSection = `      {analysis && (\n        <div className="section">\n          <div className="section-header">\n            <span className="label">Tools</span>\n          </div>\n          <div style={{ display: "grid", gap: 8 }}>\n            <button type="button" className="btn ghost w-full" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-ltx-director"))}>✦ Director</button>\n            <button type="button" className="btn ghost w-full" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-reference-chat"))}>＋ References</button>\n            <button type="button" className="btn ghost w-full" onClick={() => window.dispatchEvent(new CustomEvent("mvs-open-promo-cut"))}>✂ Promo Cut</button>\n          </div>\n          <div className="rail-help">Open creative tools here without covering the timeline.</div>\n        </div>\n      )}\n\n${referenceSection}`;

  return replaceRequired(source, referenceSection, toolsSection, "left-rail Director tools");
}

export function patchDirectorLeftRailLauncher(source, replaceRequired) {
  let patched = source;

  const apiImport = `import { startTextToImage, pollTask, saveImageToLibrary } from "../lib/api.js";`;
  const visionImports = `${apiImport}\nimport { parseDirectorVision } from "../lib/directorVisionParser.js";\nimport { buildVisionTimelineClips } from "../lib/directorAgentVision.js";`;
  if (!patched.includes('buildVisionTimelineClips')) {
    patched = replaceRequired(patched, apiImport, visionImports, "active Director Vision imports");
  }

  if (patched.includes("const SESSION_VERSION = 2;")) {
    patched = patched.replace("const SESSION_VERSION = 2;", "const SESSION_VERSION = 3;");
  }

  const clipProgressAnchor = `  const clipProgress = useMemo(() => ({ ready: clips.filter((clip) => clip.status === "ready").length, active: clips.filter((clip) => clip.status === "queued" || clip.status === "generating").length, failed: clips.filter((clip) => clip.status === "failed").length, completed: clips.filter((clip) => clip.status === "ready" || clip.status === "failed").length }), [clips]);`;
  const visionStatus = `${clipProgressAnchor}\n  const parsedVision = useMemo(() => parseDirectorVision(session.vision), [session.vision]);`;
  if (!patched.includes("const parsedVision = useMemo")) {
    patched = replaceRequired(patched, clipProgressAnchor, visionStatus, "active Director Vision status");
  }

  const planSetup = `    setError(null); setBusy("Gemini is studying the song, references, and exact Agnes clip boundaries");\n    try {`;
  const visionPlanSetup = `    const parsedVisionForPlan = parseDirectorVision(session.vision);\n    const planningClips = buildVisionTimelineClips(session.vision, clips);\n    if (parsedVisionForPlan.mode === "structured" && planningClips.length !== parsedVisionForPlan.shots.length) {\n      setError("The Director could not preserve every shot in your timecoded Vision. Nothing was changed.");\n      return;\n    }\n    const authoritativeMustInclude = parsedVisionForPlan.mode === "structured"\n      ? [\n          session.mustInclude.trim(),\n          "AUTHORITATIVE TIMECODED SHOT LIST — preserve every shot, time range, and instruction exactly; enhance prompts only, never merge, omit, reorder, or replace these shots:",\n          ...planningClips.map((clip, index) => \`Shot \${index + 1} \${clip.start.toFixed(2)}-\${clip.end.toFixed(2)}s: \${clip.userDirection || clip.prompt || clip.sectionLabel || ""}\`),\n        ].filter(Boolean).join("\\n")\n      : session.mustInclude;\n    setError(null); setBusy(parsedVisionForPlan.mode === "structured"\n      ? \`Gemini is enhancing your \${planningClips.length}-shot Vision without changing its structure\`\n      : "Gemini is studying the song, references, and analyzer clip boundaries");\n    try {`;
  if (!patched.includes("const planningClips = buildVisionTimelineClips(session.vision, clips)")) {
    patched = replaceRequired(patched, planSetup, visionPlanSetup, "active Director structured planning clips");
  }

  const analyzerPayload = `mustInclude: session.mustInclude, avoid: session.avoid, characterRequired: session.characterRequired, characterImageUrl: characterImageUrl || undefined, analysis, clips: clips.map((clip) => ({ id: clip.id, start: clip.start, end: clip.end, sectionLabel: clip.sectionLabel || undefined }))`;
  const visionPayload = `mustInclude: authoritativeMustInclude, avoid: session.avoid, characterRequired: session.characterRequired, characterImageUrl: characterImageUrl || undefined, analysis, clips: planningClips.map((clip) => ({ id: clip.id, start: clip.start, end: clip.end, sectionLabel: clip.sectionLabel || undefined, userDirection: clip.userDirection || clip.prompt || undefined }))`;
  if (patched.includes(analyzerPayload)) {
    patched = patched.replace(analyzerPayload, visionPayload);
  } else if (patched.includes(`mustInclude: session.mustInclude, avoid: session.avoid, characterRequired: session.characterRequired, characterImageUrl: characterImageUrl || undefined, analysis, clips: planningClips.map`)) {
    patched = patched.replace(`mustInclude: session.mustInclude, avoid: session.avoid, characterRequired: session.characterRequired, characterImageUrl: characterImageUrl || undefined, analysis, clips: planningClips.map`, `mustInclude: authoritativeMustInclude, avoid: session.avoid, characterRequired: session.characterRequired, characterImageUrl: characterImageUrl || undefined, analysis, clips: planningClips.map`);
  }

  const planResultAnchor = `      updateSession({ plan, planAccepted: false, productionStarted: false, characterApproved: false, treatmentApproved: false, sceneApprovals: {}, shotApprovals: {} }); toast.success(\`Agnes Director plan created with \${plan.agentModel}\`);`;
  const visionPlanResult = `      if (parsedVisionForPlan.mode === "structured") {\n        useStore.setState({ clips: planningClips, selectedClipId: planningClips[0]?.id ?? null });\n      }\n      updateSession({ plan, planAccepted: false, productionStarted: false, characterApproved: false, treatmentApproved: false, sceneApprovals: {}, shotApprovals: {} });\n      toast.success(parsedVisionForPlan.mode === "structured"\n        ? \`Your \${planningClips.length}-shot Vision is now the Director timeline\`\n        : \`Agnes Director plan created with \${plan.agentModel}\`);`;
  if (!patched.includes("Your ${planningClips.length}-shot Vision is now the Director timeline")) {
    patched = replaceRequired(patched, planResultAnchor, visionPlanResult, "materialize structured Vision timeline");
  }

  const visionField = `<Field label="Vision" value={session.vision} onChange={(vision) => updateSession({ vision, planAccepted: false })} placeholder="Describe the story, performance, world, emotion, locations, wardrobe, and camera behavior." /><Field label="Must include"`;
  const visionFieldWithStatus = `<Field label="Vision" value={session.vision} onChange={(vision) => updateSession({ vision, planAccepted: false })} placeholder="Describe the story, performance, world, emotion, locations, wardrobe, and camera behavior." />{parsedVision.mode === "structured" ? <div style={visionOverrideStyle}>✓ Vision override detected: {parsedVision.shots.length} timecoded shots. Your shot count and timing will replace analyzer sections.</div> : <div style={visionFallbackStyle}>No timecoded shot list detected. The Director will use analyzer sections unless you paste explicit shot timecodes.</div>}<Field label="Must include"`;
  if (!patched.includes("Vision override detected:")) {
    patched = replaceRequired(patched, visionField, visionFieldWithStatus, "visible structured Vision detection");
  }

  const styleAnchor = `const blockingStyle: CSSProperties = { marginTop: 10, padding: 9, borderRadius: 8, background: "rgba(239,68,68,.12)", color: "#fca5a5", fontSize: 12 };`;
  const stylesWithVision = `${styleAnchor}\nconst visionOverrideStyle: CSSProperties = { marginTop: 9, padding: 10, borderRadius: 9, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.28)", color: "#bbf7d0", fontSize: 12 };\nconst visionFallbackStyle: CSSProperties = { marginTop: 9, padding: 10, borderRadius: 9, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.22)", color: "#fde68a", fontSize: 12 };`;
  if (!patched.includes("const visionOverrideStyle")) {
    patched = replaceRequired(patched, styleAnchor, stylesWithVision, "structured Vision status styles");
  }

  if (!patched.includes('mvs-open-ltx-director')) {
    const effectAnchor = `  useEffect(() => { const onReference = (event: Event) => { const detail = (event as CustomEvent<DirectorReferenceDetail>).detail; if (detail?.kind === "character" && detail.url) setCharacter(detail.url); setReferenceRevision((value) => value + 1); setOpen(true); }; window.addEventListener(REFERENCE_EVENT, onReference as EventListener); return () => window.removeEventListener(REFERENCE_EVENT, onReference as EventListener); }, [setCharacter]);`;
    const effectWithLauncher = `${effectAnchor}\n  useEffect(() => { const openDirector = () => setOpen(true); window.addEventListener("mvs-open-ltx-director", openDirector); return () => window.removeEventListener("mvs-open-ltx-director", openDirector); }, []);`;
    patched = replaceRequired(patched, effectAnchor, effectWithLauncher, "left-rail Director open event");
  }

  const floatingLauncher = `  if (!open) return <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>✦ Agnes Director Agent{clipProgress.active > 0 && <span style={activeDotStyle} />}</button>;`;
  if (patched.includes(floatingLauncher)) {
    patched = patched.replace(floatingLauncher, `  if (!open) return null;`);
  } else if (!patched.includes(`if (!open) return null;`)) {
    throw new Error("Could not remove the floating Director launcher.");
  }
  return patched;
}

export function patchReferenceLeftRailLauncher(source) {
  if (!source.includes('mvs-open-reference-chat')) {
    throw new Error("Reference Chat is missing its left-rail open event listener.");
  }
  const floatingLauncher = `  if (!open) {\n    return (\n      <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>\n        ＋ References\n        {uploading && <span style={activityDotStyle} aria-label="Reference processing active" />}\n        {items.length > 0 && <span style={countStyle}>{items.length}</span>}\n      </button>\n    );\n  }`;
  if (source.includes(floatingLauncher)) return source.replace(floatingLauncher, `  if (!open) return null;`);
  if (source.includes(`if (!open) return null;`)) return source;
  throw new Error("Could not remove the floating References launcher.");
}

export function patchPromoLeftRailLauncher(source, replaceRequired) {
  let patched = source;
  if (!patched.includes('mvs-open-promo-cut')) {
    const stateEffect = `  useEffect(() => {\n    setPromoMeta(readPromoMeta(songId));\n    setStart(0);\n    setEnd(duration);\n    setPreviewing(false);\n    setProgress(null);\n  }, [songId, duration]);`;
    const stateWithLauncher = `${stateEffect}\n\n  useEffect(() => {\n    const openPromo = () => setOpen(true);\n    window.addEventListener("mvs-open-promo-cut", openPromo);\n    return () => window.removeEventListener("mvs-open-promo-cut", openPromo);\n  }, []);`;
    patched = replaceRequired(patched, stateEffect, stateWithLauncher, "left-rail Promo open event");
  }

  const floatingLauncher = `    <>\n      <button type="button" style={launcherStyle} onClick={() => setOpen(true)}>\n        ✂ {promoMeta ? "Promo active" : "Promo Cut"}\n      </button>\n\n      {open && (`;
  const leftRailOnly = `    <>\n      {open && (`;
  if (patched.includes(floatingLauncher)) patched = patched.replace(floatingLauncher, leftRailOnly);
  else if (!patched.includes(leftRailOnly)) throw new Error("Could not remove the floating Promo launcher.");
  return patched;
}
