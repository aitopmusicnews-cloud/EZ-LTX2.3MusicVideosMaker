import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => signal ? rejectRun(new Error(`${command} stopped after ${signal}`)) : code !== 0 ? rejectRun(new Error(`${command} exited with code ${code}`)) : resolveRun());
  });
}

await run("tsc", ["-p", "tsconfig.json"]);

// Keep the Gemini request on the smallest generateContent surface that the
// deployed v1beta endpoint accepts. The Director validates returned JSON with
// Zod, so structured-output request configuration is not required here.
const directorDistPath = resolve(process.cwd(), "dist/director_agent.js");
let directorDist = await readFile(directorDistPath, "utf8");
directorDist = directorDist.replace(/\s*temperature:\s*0\.35,\s*/g, "\n");

const legacyJsonSchemaConfig = `responseMimeType: "application/json",
                responseJsonSchema: RESPONSE_SCHEMA,`;
const legacyResponseSchemaConfig = `responseMimeType: "application/json",
                responseSchema: RESPONSE_SCHEMA,`;
const stringResponseFormat = `responseFormat: {
                    text: {
                        mimeType: "application/json",
                        schema: RESPONSE_SCHEMA,
                    },
                },`;
const enumResponseFormat = `responseFormat: {
                    text: {
                        mimeType: "APPLICATION_JSON",
                        schema: RESPONSE_SCHEMA,
                    },
                },`;
for (const structuredOutputConfig of [legacyJsonSchemaConfig, legacyResponseSchemaConfig, stringResponseFormat, enumResponseFormat]) {
  directorDist = directorDist.replace(structuredOutputConfig, "");
}

const oldPartsInit = `const parts = [{ text: requestContext(req, references) }];`;
const schemaPromptPartsInit = `const parts = [{ text: requestContext(req, references) + "\\n\\nReturn ONLY valid JSON with no markdown fences or commentary. Match this JSON Schema exactly:\\n" + JSON.stringify(RESPONSE_SCHEMA) }];`;
if (directorDist.includes(oldPartsInit)) {
  directorDist = directorDist.replace(oldPartsInit, schemaPromptPartsInit);
} else if (!directorDist.includes("Match this JSON Schema exactly")) {
  throw new Error("Could not find the compiled Gemini Director prompt initialization.");
}

const oldJsonParse = `parsedJson = JSON.parse(responseText);`;
const tolerantJsonParse = 'parsedJson = JSON.parse(responseText.replace(/^```(?:json)?\\s*/i, "").replace(/\\s*```$/, "").trim());';
if (directorDist.includes(oldJsonParse)) directorDist = directorDist.replace(oldJsonParse, tolerantJsonParse);

const oldErrorParser = `let message = text;
        try {
            message = JSON.parse(text)?.error?.message ?? text;
        }
        catch {
            // Keep the original response text.
        }`;
const detailedErrorParser = `let message = text;
        try {
            const parsedError = JSON.parse(text)?.error;
            if (parsedError) {
                const details = Array.isArray(parsedError.details) && parsedError.details.length > 0
                    ? \` Details: \${JSON.stringify(parsedError.details)}\`
                    : "";
                message = \`\${parsedError.message ?? text}\${details}\`;
            }
        }
        catch {
            // Keep the original response text.
        }`;
if (directorDist.includes(oldErrorParser)) directorDist = directorDist.replace(oldErrorParser, detailedErrorParser);

// The Director source is compiled first, then this build step applies the
// production request contract. Wire transient Gemini capacity handling here so
// the deployed artifact retries 429/503/high-demand/network timeouts and can
// fall back to the stable Gemini 2.5 Flash model without changing user plans.
const resilienceImport = `import { runGeminiDirectorWithFallback } from "./gemini_director_retry.js";`;
if (!directorDist.includes(resilienceImport)) directorDist = `${resilienceImport}\n${directorDist}`;

const legacyGeminiError = 'throw new Error(`Gemini Director failed: ${message.slice(0, 800)}`);';
const statusAwareGeminiError = 'throw new Error(`Gemini Director failed (${response.status}): ${message.slice(0, 800)}`);';
if (directorDist.includes(legacyGeminiError)) directorDist = directorDist.replace(legacyGeminiError, statusAwareGeminiError);
else if (!directorDist.includes("Gemini Director failed (${response.status})")) throw new Error("Could not make Gemini Director HTTP errors status-aware.");

const modelDeclaration = `const model = config.GEMINI_DIRECTOR_MODEL;`;
const resilientModelDeclaration = `${modelDeclaration}\n    let successfulModel = model;`;
if (!directorDist.includes("let successfulModel = model;")) {
  if (!directorDist.includes(modelDeclaration)) throw new Error("Could not find Gemini Director model declaration.");
  directorDist = directorDist.replace(modelDeclaration, resilientModelDeclaration);
}

const directGeminiCall = `const response = await callGemini(attemptParts, model);`;
const resilientGeminiCall = `const resilientGemini = await runGeminiDirectorWithFallback(model, (candidateModel) => callGemini(attemptParts, candidateModel));\n        const response = resilientGemini.value;\n        successfulModel = resilientGemini.model;`;
if (!directorDist.includes("runGeminiDirectorWithFallback(model")) {
  if (!directorDist.includes(directGeminiCall)) throw new Error("Could not find direct Gemini Director call.");
  directorDist = directorDist.replace(directGeminiCall, resilientGeminiCall);
}

if (directorDist.includes("agentModel: model,")) directorDist = directorDist.replace("agentModel: model,", "agentModel: successfulModel,");
if (!directorDist.includes("agentModel: successfulModel,")) throw new Error("Gemini Director plan does not report the model that actually succeeded.");

directorDist = directorDist.replace(/AbortSignal\.timeout\(180_000\)/g, "AbortSignal.timeout(600_000)");
directorDist = directorDist.replace(
  "The plan must be practical for independent 1-to-5-second Agnes clips that are later edited together.",
  "The timeline clips are analyzer-defined musical sections and may be longer than five seconds. Preserve every supplied start/end boundary exactly; the application internally splits long sections into provider-sized generations and stitches them back into one approval unit."
);

if (directorDist.includes("temperature: 0.35")) throw new Error("Gemini Director build still contains deprecated temperature configuration.");
for (const forbidden of ["responseFormat:", "responseMimeType:", "responseJsonSchema:", "responseSchema:"]) {
  if (directorDist.includes(forbidden)) throw new Error(`Gemini Director build still contains unsupported structured-output configuration: ${forbidden}`);
}
if (!directorDist.includes("Match this JSON Schema exactly")) throw new Error("Gemini Director build is missing the schema-in-prompt contract.");
if (directorDist.includes("AbortSignal.timeout(180_000)")) throw new Error("Gemini Director build still contains the old three-minute timeout.");
if (!directorDist.includes("AbortSignal.timeout(600_000)")) throw new Error("Gemini Director build is missing the ten-minute planning timeout.");
if (directorDist.includes("1-to-5-second Agnes clips")) throw new Error("Gemini Director prompt still assumes five-second timeline clips.");
if (!directorDist.includes("runGeminiDirectorWithFallback(model")) throw new Error("Gemini Director build is missing transient-capacity retry/fallback handling.");
await writeFile(directorDistPath, directorDist, "utf8");

// Register routes whose implementation files are compiled by tsc but are kept
// isolated from the legacy one-line server source. Dynamic imports keep this
// patch small and make missing route wiring fail loudly during the build.
const serverDistPath = resolve(process.cwd(), "dist/server.js");
let serverDist = await readFile(serverDistPath, "utf8");
const routeAnchor = `function sniffMatches(buf, family) {`;
if (!serverDist.includes(routeAnchor)) throw new Error("Could not find the compiled server route insertion anchor.");
if (!serverDist.includes('/api/director/chat')) {
  const routes = `app.post("/api/director/chat", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
        const { chatWithDirector } = await import("./director_chat.js");
        return reply.send(await chatWithDirector(req.body));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        req.log.error({ err: error }, "Agnes Director chat failed");
        return reply.code(message.includes("GEMINI_API_KEY") ? 503 : message.includes("invalid") || message.includes("unknown") ? 400 : 500).send({ error: message });
    }
});
app.post("/api/videos/stitch", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ projectId: SafeId, videos: z.array(z.string().min(1)).min(1).max(40) }).parse(req.body);
    const { stitchVideoSegments } = await import("./video_stitch.js");
    return reply.send(await stitchVideoSegments(body.projectId, body.videos));
});
app.post("/api/social/export", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ projectId: SafeId, videoUrl: z.string().min(1), preset: z.enum(["vertical", "square", "landscape"]) }).parse(req.body);
    const { exportSocialVideo } = await import("./social_export.js");
    return reply.send(await exportSocialVideo(body.projectId, body.videoUrl, body.preset));
});
${routeAnchor}`;
  serverDist = serverDist.replace(routeAnchor, routes);
}
if (!serverDist.includes('/api/director/chat')) throw new Error("Compiled API is missing /api/director/chat.");
if (!serverDist.includes('/api/videos/stitch')) throw new Error("Compiled API is missing /api/videos/stitch.");
if (!serverDist.includes('/api/social/export')) throw new Error("Compiled API is missing /api/social/export.");
await writeFile(serverDistPath, serverDist, "utf8");

console.log("[api build] Compiled Director planning/chat with Gemini capacity retries/fallback, analyzer-length sections, long-section stitching, social exports, and ten-minute planning timeout.");
