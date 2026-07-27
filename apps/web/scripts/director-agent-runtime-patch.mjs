export function patchDirectorAgentRuntime(source, replaceRequired) {
  let patched = source;

  patched = replaceRequired(
    patched,
    `    seedImageUrl: string;\n    prompt: string;`,
    `    seedImageUrl: string;\n    requiresCharacter: boolean;\n    prompt: string;`,
    "queued job character requirement",
  );

  patched = replaceRequired(
    patched,
    `  seedImageUrl: string;\n  prompt: string;`,
    `  seedImageUrl: string;\n  requiresCharacter?: boolean;\n  prompt: string;`,
    "enqueue character requirement",
  );

  patched = replaceRequired(
    patched,
    `      seedImageUrl: input.seedImageUrl,\n      prompt: input.prompt,`,
    `      seedImageUrl: input.seedImageUrl,\n      requiresCharacter: input.requiresCharacter === true,\n      prompt: input.prompt,`,
    "persist character requirement in queue",
  );

  patched = replaceRequired(
    patched,
    `  if (job.input.source === "textToVideo") {\n    return startTextToVideo({`,
    `  if (job.input.requiresCharacter && job.input.source === "textToVideo") {\n    throw new Error("Character conditioning is required. This clip cannot fall back to text-to-video.");\n  }\n\n  if (job.input.source === "textToVideo") {\n    return startTextToVideo({`,
    "block character text fallback",
  );

  patched = replaceRequired(
    patched,
    `  if (!firstFrame) throw new Error("Image-to-video requires a first-frame reference");\n\n  return startImageToVideo({`,
    `  if (!firstFrame) {\n    throw new Error(job.input.requiresCharacter\n      ? "Character conditioning is required. No character image was attached."\n      : "Image-to-video requires a first-frame reference");\n  }\n\n  return startImageToVideo({`,
    "strict first frame validation",
  );

  patched = replaceRequired(
    patched,
    `    promptImage: firstFrame,\n    promptText,`,
    `    promptImage: firstFrame,\n    characterRequired: job.input.requiresCharacter,\n    promptText,`,
    "send character requirement to API",
  );

  return patched;
}

export function patchDirectorAgentComponent(source, replaceRequired) {
  return replaceRequired(
    source,
    `  const updateCharacterBible = (key: keyof CharacterBible, value: CharacterBible[keyof CharacterBible]) => setSession((current) => current.plan ? { ...current, planAccepted: false, plan: { ...current.plan, characterBible: { ...current.plan.characterBible, [key]: value } } } : current);`,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => setSession((current) => current.plan ? { ...current, planAccepted: false, plan: { ...current.plan, characterBible: { ...current.plan.characterBible, [key]: value } } } : current);`,
    "typed character bible editor",
  );
}

export function patchDirectorReferenceChat(source, replaceRequired) {
  return replaceRequired(
    source,
    `  useEffect(() => {\n    if (!songId) return;\n    localStorage.setItem(storageKey(songId), JSON.stringify(items));\n  }, [items, songId]);\n\n  if (!songId) return null;`,
    `  useEffect(() => {\n    if (!songId) return;\n    localStorage.setItem(storageKey(songId), JSON.stringify(items));\n  }, [items, songId]);\n\n  useEffect(() => {\n    const openFromDirector = () => setOpen(true);\n    window.addEventListener("mvs-open-reference-chat", openFromDirector);\n    return () => window.removeEventListener("mvs-open-reference-chat", openFromDirector);\n  }, []);\n\n  if (!songId) return null;`,
    "open Reference Chat from LTX Director Agent",
  );
}
