import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const patchPath = resolve(scriptsRoot, "left-rail-tools.patch.mjs");
let source = await readFile(patchPath, "utf8");

const guardLines = [
  '    if (parsedVisionForPlan.mode === "structured" && planningClips.length !== parsedVisionForPlan.shots.length) {',
  '      setError("The Director could not preserve every shot in your timecoded Vision. Nothing was changed.");',
  '      return;',
  '    }',
];
for (const separator of ["\\n", "\n"]) {
  const guard = guardLines.join(separator);
  if (source.includes(guard)) source = source.replace(guard, "");
}

if (/could not preserve every shot in your timecoded Vision/i.test(source)) {
  throw new Error("Could not remove the obsolete structured-Vision clip-count guard.");
}

source = source.replace(
  "Your shot count and timing will replace analyzer sections.",
  "Your timecoded Vision overrides analyzer sections. Director clip amount in Tools controls how many production clips are built.",
);
source = source.replace(
  '`Gemini is enhancing your ${planningClips.length}-shot Vision without changing its structure`',
  '`Gemini is building ${planningClips.length} production clips from your timecoded Vision`',
);

await writeFile(patchPath, source, "utf8");
console.log("[web prebuild] Enabled editable Director production clip count.");
