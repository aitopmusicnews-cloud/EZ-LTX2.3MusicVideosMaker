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
  return patched;
}
