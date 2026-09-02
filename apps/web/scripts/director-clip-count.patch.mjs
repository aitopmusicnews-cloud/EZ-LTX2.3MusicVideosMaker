export function patchDirectorClipCount(source, replaceRequired) {
  let patched = source;

  if (!patched.includes("clipCount: number | null")) {
    patched = replaceRequired(
      patched,
      "type AgentSession = { vision: string; mustInclude:",
      "type AgentSession = { vision: string; clipCount: number | null; mustInclude:",
      "Director clip-count session field",
    );
  }

  if (!patched.includes('vision: "", clipCount: null, mustInclude:')) {
    patched = replaceRequired(
      patched,
      'return { vision: "", mustInclude:',
      'return { vision: "", clipCount: null, mustInclude:',
      "Director clip-count session default",
    );
  }

  const oldPlanning = `    const planningClips = buildVisionTimelineClips(session.vision, clips);\n    if (parsedVisionForPlan.mode === "structured" && planningClips.length !== parsedVisionForPlan.shots.length) {\n      setError("The Director could not preserve every shot in your timecoded Vision. Nothing was changed.");\n      return;\n    }`;
  const newPlanning = `    const suggestedClipCount = parsedVisionForPlan.mode === "structured" ? parsedVisionForPlan.shots.length : clips.length;\n    const requestedClipCount = Math.max(1, Math.min(80, Math.round(session.clipCount ?? suggestedClipCount)));\n    const planningClips = buildVisionTimelineClips(session.vision, clips, requestedClipCount);`;
  if (!patched.includes("buildVisionTimelineClips(session.vision, clips, requestedClipCount)")) {
    patched = replaceRequired(patched, oldPlanning, newPlanning, "editable Director planning clip count");
  }

  patched = patched.replace(
    "AUTHORITATIVE TIMECODED SHOT LIST — preserve every shot, time range, and instruction exactly; enhance prompts only, never merge, omit, reorder, or replace these shots:",
    "AUTHORITATIVE PRODUCTION CLIP LIST — preserve every supplied clip, time range, and instruction exactly; enhance prompts only, never omit, reorder, or replace these clips:",
  );
  patched = patched.replace(
    '`Gemini is enhancing your ${planningClips.length}-shot Vision without changing its structure`',
    '`Gemini is building ${planningClips.length} production clips from your timecoded Vision`',
  );

  const mustIncludeAnchor = `}<Field label="Must include"`;
  const clipCountControl = `}<label style={fieldStyle}><span>Clip amount</span><input type="number" min={1} max={80} step={1} value={session.clipCount ?? (parsedVision.mode === "structured" ? parsedVision.shots.length : clips.length)} onChange={(event) => { const next = Number(event.target.value); updateSession({ clipCount: Number.isFinite(next) ? Math.max(1, Math.min(80, Math.round(next))) : null, planAccepted: false }); }} style={inputStyle} /><span style={smallStyle}>Choose 1–80 production clips. Increase the amount to split your plan into more clips; decrease it to combine adjacent plan shots.</span></label><Field label="Must include"`;
  if (!patched.includes("Clip amount")) {
    patched = replaceRequired(patched, mustIncludeAnchor, clipCountControl, "Director clip amount input");
  }

  patched = patched.replace(
    "Your shot count and timing will replace analyzer sections.",
    "Your timecoded Vision overrides analyzer sections. Clip Amount controls how many production clips are built from it.",
  );

  return patched;
}
