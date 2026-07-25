export function repairDirectorPreviewPatch(source, replaceRequired) {
  let patched = source;

  const repairOptional = (from, to) => {
    if (patched.includes(from)) patched = patched.replace(from, to);
  };

  repairOptional(
    `  const updateCharacterBible = <K extends keyof CharacterBible,>  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {`,
    `  const updateCharacterBible = <K extends keyof CharacterBible,>(key: K, value: CharacterBible[K]) => {`,
  );

  repairOptional(
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {`,
    `  const updateShot = (shotId: string, patch: Partial<LtxShotPlan>) => {`,
  );

  repairOptional(
    `  const resolveReferenceUrl = (referenceId: string | null): string => {  const resolveReferenceUrl = (referenceId: string | null): string => {`,
    `  const resolveReferenceUrl = (referenceId: string | null): string => {`,
  );

  repairOptional(
    `  const approveActiveSongSection = () => {  const approveActiveSongSection = () => {`,
    `  const approveActiveSongSection = () => {`,
  );

  repairOptional(
    `  const validateAndApplyPlan = (): boolean => {  const validateAndApplyPlan = (): boolean => {`,
    `  const validateAndApplyPlan = (): boolean => {`,
  );

  patched = replaceRequired(
    patched,
    `const SESSION_VERSION = 1;`,
    `const SESSION_VERSION = 2;`,
    "reset legacy Director sessions without required previews",
  );

  patched = replaceRequired(
    patched,
    `      if (detail?.kind === "character" && detail.url) setCharacter(detail.url);
      setReferenceRevision((value) => value + 1);
      setOpen(true);`,
    `      if (detail?.kind === "character" && detail.url) {
        setCharacter(detail.url);
        setSession((current) => ({
          ...current,
          characterBibleApproved: false,
          treatmentApproved: false,
          approvedSectionKeys: [],
          activeSectionIndex: 0,
          stylePreviewUrl: null,
          sectionPreviewUrls: {},
          planAccepted: false,
        }));
      }
      setReferenceRevision((value) => value + 1);
      setOpen(true);`,
    "invalidate previews when the character reference changes",
  );

  patched = replaceRequired(
    patched,
    `      setSession((current) => ({
        ...current,
        sectionPreviewUrls: { ...current.sectionPreviewUrls, [section.key]: outputUrl },
        approvedSectionKeys: current.approvedSectionKeys.filter((key) => key !== section.key),
        planAccepted: false,
      }));`,
    `      const sectionIndex = approvalSections.findIndex((item) => item.key === section.key);
      const retainedKeys = new Set(
        approvalSections.slice(0, Math.max(0, sectionIndex)).map((item) => item.key),
      );
      setSession((current) => ({
        ...current,
        sectionPreviewUrls: {
          ...Object.fromEntries(Object.entries(current.sectionPreviewUrls).filter(([key]) => retainedKeys.has(key))),
          [section.key]: outputUrl,
        },
        approvedSectionKeys: current.approvedSectionKeys.filter((key) => retainedKeys.has(key)),
        activeSectionIndex: sectionIndex >= 0 ? sectionIndex : current.activeSectionIndex,
        planAccepted: false,
      }));`,
    "invalidate current and later approvals after preview regeneration",
  );

  patched = replaceRequired(
    patched,
    `    if (!session.treatmentApproved || !session.characterBibleApproved || !allSectionsApproved) {`,
    `    if (
      !session.characterBibleApproved ||
      !session.treatmentApproved ||
      !session.stylePreviewUrl ||
      !allSectionsApproved ||
      approvalSections.some((section) => !session.sectionPreviewUrls[section.key])
    ) {`,
    "require persisted previews before timeline build",
  );

  patched = replaceRequired(
    patched,
    `    const plan = session.plan;
    if (!plan || !session.characterBibleApproved) return;
    const characterUrl = resolveReferenceUrl(plan.characterBible.referenceId);`,
    `    const plan = session.plan;
    if (!plan) {
      const message = "Create the Director plan before generating a style preview.";
      setError(message);
      toast.error(message);
      return;
    }
    if (!session.characterBibleApproved) {
      const message = "Approve and lock the visible character before generating the style preview.";
      setError(message);
      toast.error(message);
      return;
    }
    const characterUrl = resolveReferenceUrl(plan.characterBible.referenceId);`,
    "show style preview precondition errors",
  );

  patched = replaceRequired(
    patched,
    `    if (session.characterRequired && !characterUrl) {
      setError("The locked character image is missing. Re-select and approve the character before generating a style preview.");
      return;
    }`,
    `    if (session.characterRequired && !characterUrl) {
      const message = "The locked character image is missing. Re-select and approve the character before generating a style preview.";
      setError(message);
      toast.error(message);
      return;
    }`,
    "surface missing style preview character",
  );

  patched = replaceRequired(
    patched,
    `    setError(null);
    setBusy("Generating the LTX character-and-style proof");
    try {`,
    `    setError(null);
    setBusy("Starting LTX visual-style preview");
    toast.info("Starting the LTX visual-style preview…", 8000);
    try {`,
    "start visible style preview progress",
  );

  patched = replaceRequired(
    patched,
    `        : await startTextToVideo({ promptText: prompt, duration: 2, model: "ltx-video" });
      const final = await pollTask(task.id, 2500, 900_000);`,
    `        : await startTextToVideo({ promptText: prompt, duration: 2, model: "ltx-video" });
      if (!task?.id) throw new Error("LTX accepted no task ID for the style preview.");
      setBusy("LTX accepted the style preview; waiting for the GPU render");
      toast.info("LTX accepted the style preview. Waiting for the GPU render…", 12000);
      const final = await pollTask(task.id, 2500, 900_000);`,
    "confirm style preview task acceptance",
  );

  patched = replaceRequired(
    patched,
    `                    <button type="button" className="btn" disabled={!!busy} onClick={() => void generateStylePreview()}>
                      {session.stylePreviewUrl ? "Regenerate LTX style preview" : "Generate LTX style preview"}
                    </button>`,
    `                    <button type="button" className="btn" disabled={!!busy} onClick={() => void generateStylePreview()}>
                      {busy?.includes("style preview")
                        ? "Generating style preview… " + elapsed + "s"
                        : session.stylePreviewUrl
                          ? "Regenerate LTX style preview"
                          : "Generate LTX style preview"}
                    </button>
                    {busy?.includes("style preview") && (
                      <div style={modelBadgeStyle}>The request is active · {elapsed}s · keep this Director window open</div>
                    )}`, 
    "show inline style preview activity",
  );

  return patched;
}
