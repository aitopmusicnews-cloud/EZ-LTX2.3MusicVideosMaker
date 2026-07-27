import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchDirectorAgentNormalization } from "./director-agent-normalize-patch.mjs";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(apiRoot, "src/server.ts");
const modalAiPath = resolve(apiRoot, "src/modalAI.ts");
const directorAgentPath = resolve(apiRoot, "src/director_agent.ts");

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: apiRoot, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => signal ? rejectRun(new Error(`${command} stopped after ${signal}`)) : code !== 0 ? rejectRun(new Error(`${command} exited with code ${code}`)) : resolveRun());
  });
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not apply ${label}; expected source text was not found.`);
  return source.replace(from, to);
}

const originalServer = await readFile(serverPath, "utf8");
const originalModalAi = await readFile(modalAiPath, "utf8");
const originalDirectorAgent = await readFile(directorAgentPath, "utf8");

let patchedServer = originalServer;
if (!patchedServer.includes('import { createDirectorPlan } from "./director_agent.js";')) {
  patchedServer = replaceRequired(
    patchedServer,
    'import { config } from "./config.js";',
    'import { config } from "./config.js";\nimport { createDirectorPlan } from "./director_agent.js";',
    "Director agent server import",
  );
}

const generationAnchor = "// Generation primitives ------------------------------------------------";
const directorRoute = `// LTX Director Agent ----------------------------------------------------

app.post("/api/director/plan", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
  try {
    return reply.send(await createDirectorPlan(req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof z.ZodError ? 400 : message.includes("GEMINI_API_KEY") ? 503 : message.includes("Character conditioning") || message.includes("character reference") ? 409 : 500;
    req.log.error({ err: error }, "LTX Director Agent failed");
    return reply.code(status).send({ error: message });
  }
});

${generationAnchor}`;

if (!patchedServer.includes('app.post("/api/director/plan"')) {
  if (patchedServer.includes(generationAnchor)) {
    patchedServer = replaceRequired(patchedServer, generationAnchor, directorRoute, "Director agent API route");
  } else {
    console.log("[api build] Director agent API route already wired elsewhere; skipped legacy route patch.");
  }
}

let patchedModalAi = originalModalAi;
const characterValidationMarker = "Character conditioning is required. LTX generation was not started because no character image was attached.";
if (!patchedModalAi.includes(characterValidationMarker)) {
  const modalAnchor = `  const duration = Math.min(5, Math.max(1, Number(req.duration ?? 5)));\n  const initImageUrl = req.promptImage ?? req.imageUrl;\n  const jobId = `;
  if (patchedModalAi.includes(modalAnchor)) {
    patchedModalAi = replaceRequired(
      patchedModalAi,
      modalAnchor,
      `  const duration = Math.min(5, Math.max(1, Number(req.duration ?? 5)));\n  const initImageUrl = req.promptImage ?? req.imageUrl;\n  const characterRequired = Boolean(\n    (req as ImageToVideoRequest & { characterRequired?: boolean; requiresCharacter?: boolean }).characterRequired ??\n    (req as ImageToVideoRequest & { characterRequired?: boolean; requiresCharacter?: boolean }).requiresCharacter\n  );\n  if (characterRequired && !initImageUrl) {\n    throw new Error("${characterValidationMarker}");\n  }\n  const jobId = `,
      "strict character condition validation",
    );

    const payloadAnchor = `        init_image_url: initImageUrl || undefined, job_id: jobId, webhook_url: webhookUrl`;
    if (patchedModalAi.includes(payloadAnchor)) {
      patchedModalAi = replaceRequired(
        patchedModalAi,
        payloadAnchor,
        `        init_image_url: initImageUrl || undefined, character_required: characterRequired, job_id: jobId, webhook_url: webhookUrl`,
        "character requirement Modal payload",
      );
    } else {
      console.log("[api build] Modal payload already has a different current shape; skipped legacy character payload patch.");
    }
  } else {
    console.log("[api build] Modal AI source already uses the current generation shape; skipped legacy character patch.");
  }
} else {
  console.log("[api build] Character conditioning validation already present; skipped legacy character patch.");
}

const patchedDirectorAgent = patchDirectorAgentNormalization(originalDirectorAgent, replaceRequired);

try {
  await writeFile(serverPath, patchedServer, "utf8");
  await writeFile(modalAiPath, patchedModalAi, "utf8");
  await writeFile(directorAgentPath, patchedDirectorAgent, "utf8");
  console.log("[api build] Wired Gemini LTX Director route, normalized creative plans, app validation, and strict character conditioning.");
  await run("tsc", ["-p", "tsconfig.json"]);
} finally {
  await writeFile(serverPath, originalServer, "utf8");
  await writeFile(modalAiPath, originalModalAi, "utf8");
  await writeFile(directorAgentPath, originalDirectorAgent, "utf8");
}
