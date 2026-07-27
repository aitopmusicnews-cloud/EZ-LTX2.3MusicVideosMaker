export function patchDirectorAgentRuntime(source, replaceRequired) {
  let patched = source;

  const queuedCharacterRequirement = `    seedImageUrl: string;\n    requiresCharacter: boolean;\n    prompt: string;`;
  if (!patched.includes(queuedCharacterRequirement)) {
    patched = replaceRequired(
      patched,
      `    seedImageUrl: string;\n    prompt: string;`,
      queuedCharacterRequirement,
      "queued job character requirement",
    );
  }

  const enqueueCharacterRequirement = `  seedImageUrl: string;\n  requiresCharacter?: boolean;\n  prompt: string;`;
  if (!patched.includes(enqueueCharacterRequirement)) {
    patched = replaceRequired(
      patched,
      `  seedImageUrl: string;\n  prompt: string;`,
      enqueueCharacterRequirement,
      "enqueue character requirement",
    );
  }

  const persistedCharacterRequirement = `      seedImageUrl: input.seedImageUrl,\n      requiresCharacter: input.requiresCharacter === true,\n      prompt: input.prompt,`;
  if (!patched.includes(persistedCharacterRequirement)) {
    patched = replaceRequired(
      patched,
      `      seedImageUrl: input.seedImageUrl,\n      prompt: input.prompt,`,
      persistedCharacterRequirement,
      "persist character requirement in queue",
    );
  }

  const blockedTextFallback = `  if (job.input.requiresCharacter && job.input.source === "textToVideo") {\n    throw new Error("Character conditioning is required. This clip cannot fall back to text-to-video.");\n  }\n\n  if (job.input.source === "textToVideo") {`;
  if (!patched.includes(blockedTextFallback)) {
    patched = replaceRequired(
      patched,
      `  if (job.input.source === "textToVideo") {\n    return startTextToVideo({`,
      blockedTextFallback + `\n    return startTextToVideo({`,
      "block character text fallback",
    );
  }

  const strictFirstFrameValidation = `  if (!firstFrame) {\n    throw new Error(job.input.requiresCharacter\n      ? "Character conditioning is required. No character image was attached."\n      : "Image-to-video requires a first-frame reference");\n  }\n\n  return startImageToVideo({`;
  if (!patched.includes(strictFirstFrameValidation)) {
    patched = replaceRequired(
      patched,
      `  if (!firstFrame) throw new Error("Image-to-video requires a first-frame reference");\n\n  return startImageToVideo({`,
      strictFirstFrameValidation,
      "strict first frame validation",
    );
  }

  const characterRequirementPayload = `    promptImage: firstFrame,\n    characterRequired: job.input.requiresCharacter,\n    promptText,`;
  if (!patched.includes(characterRequirementPayload)) {
    patched = replaceRequired(
      patched,
      `    promptImage: firstFrame,\n    promptText,`,
      characterRequirementPayload,
      "send character requirement to API",
    );
  }

  return patched;
}

export function patchDirectorAgentComponent(source, replaceRequired) {
  const typedEditor = `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => setSession((current) => current.plan ? { ...current, planAccepted: false, plan: { ...current.plan, characterBible: { ...current.plan.characterBible, [key]: value } } } : current);`;

  // This patch is intentionally idempotent. Render can build from a commit where
  // the Director component has already been normalized by a previous patch.
  if (source.includes(typedEditor)) return source;

  return replaceRequired(
    source,
    `  const updateCharacterBible = (key: keyof CharacterBible, value: CharacterBible[keyof CharacterBible]) => setSession((current) => current.plan ? { ...current, planAccepted: false, plan: { ...current.plan, characterBible: { ...current.plan.characterBible, [key]: value } } } : current);`,
    typedEditor,
    "typed character bible editor",
  );
}

export function patchDirectorReferenceChat(source, replaceRequired) {
  const listener = `  useEffect(() => {\n    if (!songId) return;\n    localStorage.setItem(storageKey(songId), JSON.stringify(items));\n  }, [items, songId]);\n\n  useEffect(() => {\n    const openFromDirector = () => setOpen(true);\n    window.addEventListener("mvs-open-reference-chat", openFromDirector);\n    return () => window.removeEventListener("mvs-open-reference-chat", openFromDirector);\n  }, []);\n\n  if (!songId) return null;`;

  if (source.includes(listener)) return source;

  return replaceRequired(
    source,
    `  useEffect(() => {\n    if (!songId) return;\n    localStorage.setItem(storageKey(songId), JSON.stringify(items));\n  }, [items, songId]);\n\n  if (!songId) return null;`,
    listener,
    "open Reference Chat from LTX Director Agent",
  );
}
