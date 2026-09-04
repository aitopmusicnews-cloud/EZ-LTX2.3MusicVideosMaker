export function patchLegacyDirectorLauncherOwnership(source, replaceRequired) {
  if (source.includes("mvs-open-assisted-director") && source.includes("VITE_SCRIPTLOCKED_DIRECTOR_ENABLED")) return source;

  const legacyEffect = `  useEffect(() => { const openDirector = () => setOpen(true); window.addEventListener("mvs-open-ltx-director", openDirector); return () => window.removeEventListener("mvs-open-ltx-director", openDirector); }, []);`;
  const exclusiveEffect = `  useEffect(() => {\n    const openDirector = () => setOpen(true);\n    const eventName = import.meta.env.VITE_SCRIPTLOCKED_DIRECTOR_ENABLED === "true" ? "mvs-open-assisted-director" : "mvs-open-ltx-director";\n    window.addEventListener(eventName, openDirector);\n    return () => window.removeEventListener(eventName, openDirector);\n  }, []);`;
  return replaceRequired(source, legacyEffect, exclusiveEffect, "Script-Locked Director exclusive launcher ownership");
}

export function patchEditorScriptLockedMount(source, replaceRequired) {
  let patched = source;
  const legacyImport = `import { LtxDirectorAgent } from "../components/LtxDirectorAgent.js";`;
  const scriptLockedImport = `import { ScriptLockedDirectorAgent } from "../components/ScriptLockedDirectorAgent.js";`;
  if (!patched.includes(scriptLockedImport)) {
    patched = replaceRequired(patched, legacyImport, `${legacyImport}\n${scriptLockedImport}`, "Script-Locked Director editor import");
  }

  const legacyMount = `      <LtxDirectorAgent />`;
  const dualMount = `      <ScriptLockedDirectorAgent />\n      <LtxDirectorAgent />`;
  if (!patched.includes(`<ScriptLockedDirectorAgent />`)) {
    patched = replaceRequired(patched, legacyMount, dualMount, "Script-Locked Director editor mount");
  }
  return patched;
}
