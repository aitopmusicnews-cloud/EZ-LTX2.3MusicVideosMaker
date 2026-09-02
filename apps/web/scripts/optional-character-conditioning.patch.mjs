export function patchOptionalCharacterConditioning(source, replaceRequired) {
  let patched = source;
  patched = replaceRequired(
    patched,
    'function emptySession(): AgentSession { return { vision: "", mustInclude: "", avoid: "", characterRequired: true,',
    'function emptySession(): AgentSession { return { vision: "", mustInclude: "", avoid: "", characterRequired: false,',
    "Make Director character conditioning optional by default",
  );
  patched = replaceRequired(
    patched,
    '    if (session.characterRequired && !characterImageUrl && characterReferences.length === 0) { setError("Character conditioning is required. Upload a character image in References and apply it as the character first."); setOpen(true); return; }\n',
    '',
    "Remove global character-conditioning blocker",
  );
  patched = replaceRequired(
    patched,
    '    if (!session.characterApproved || !session.treatmentApproved || !scenesApproved || !shotsApproved) { setError("Production is locked until the character, treatment text, every scene image, and every shot image are approved."); return; }\n',
    '    const characterConditioningRequired = plan.shots.some((shot) => shot.requiresCharacter);\n    if ((characterConditioningRequired && !session.characterApproved) || !session.treatmentApproved || !scenesApproved || !shotsApproved) { setError(characterConditioningRequired ? "Production is locked until the character, treatment text, every scene image, and every shot image are approved." : "Production is locked until the treatment text, every scene image, and every shot image are approved."); return; }\n',
    "Require character approval only for character-conditioned shots",
  );
  patched = replaceRequired(
    patched,
    'disabled={!!busy || !session.characterApproved || !session.treatmentApproved || !session.plan.shots.every((shot) => session.sceneApprovals[shot.clipId]?.approved) || !session.plan.shots.every((shot) => session.shotApprovals[shot.clipId]?.approved)}',
    'disabled={!!busy || (session.plan.shots.some((shot) => shot.requiresCharacter) && !session.characterApproved) || !session.treatmentApproved || !session.plan.shots.every((shot) => session.sceneApprovals[shot.clipId]?.approved) || !session.plan.shots.every((shot) => session.shotApprovals[shot.clipId]?.approved)}',
    "Allow production without character approval for text-only plans",
  );
  patched = replaceRequired(
    patched,
    '1. Characters — approve the visual reference',
    '1. Characters — optional visual reference',
    "Clarify optional character references",
  );
  patched = replaceRequired(
    patched,
    'The Director starts with the character. Upload or apply a character reference, then approve the exact image that should anchor the production.',
    'Add and approve a character reference only when a shot needs consistent character conditioning. Text-only shots can proceed without one.',
    "Clarify when character approval is needed",
  );
  patched = replaceRequired(
    patched,
    '<div style={blockingStyle}>No character reference is active. Open References and apply a character image before continuing.</div>',
    '<div style={helpStyle}>No character reference is active. Text-only shots can continue without character conditioning.</div>',
    "Remove misleading missing-character blocker",
  );
  patched = replaceRequired(
    patched,
    '>Start conditioned Agnes production</button>',
    '>Start Agnes production</button>',
    "Rename production action for optional conditioning",
  );
  return patched;
}
