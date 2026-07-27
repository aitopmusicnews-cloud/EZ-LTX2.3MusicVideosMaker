import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(apiRoot, "src/server.ts");
const modalAiPath = resolve(apiRoot, "src/modalAI.ts");

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
    const status = message.includes("GEMINI_API_KEY") ? 503 : message.includes("Character conditioning") || message.includes("character reference") ? 409 : 500;
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

// Current Modal AI source owns character validation and payload shape. Do not
// rewrite it during the build: previous text-based patches caused drift and
// masked the actual TypeScript errors in the API source.
const patchedModalAi = originalModalAi;

try {
  await writeFile(serverPath, patchedServer, "utf8");
  await writeFile(modalAiPath, patchedModalAi, "utf8");
  console.log("[api build] Wired Gemini LTX Director route without legacy Director/Modal source rewriting.");
  await run("tsc", ["-p", "tsconfig.json"]);
} finally {
  await writeFile(serverPath, originalServer, "utf8");
  await writeFile(modalAiPath, originalModalAi, "utf8");
}
