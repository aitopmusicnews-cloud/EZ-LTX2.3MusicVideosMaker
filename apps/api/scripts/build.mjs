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
// deployed v1beta endpoint accepts. The Director already validates the returned
// JSON with Zod, so structured-output API configuration is not required here.
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

// Give Gemini the exact contract as prompt text instead. This avoids request-
// validation failures while preserving strict server-side validation and retry.
const oldPartsInit = `const parts = [{ text: requestContext(req, references) }];`;
const schemaPromptPartsInit = `const parts = [{ text: requestContext(req, references) + "\\n\\nReturn ONLY valid JSON with no markdown fences or commentary. Match this JSON Schema exactly:\\n" + JSON.stringify(RESPONSE_SCHEMA) }];`;
if (directorDist.includes(oldPartsInit)) {
  directorDist = directorDist.replace(oldPartsInit, schemaPromptPartsInit);
} else if (!directorDist.includes("Match this JSON Schema exactly")) {
  throw new Error("Could not find the compiled Gemini Director prompt initialization.");
}

// Accept a fenced JSON response defensively even though the prompt forbids it.
const oldJsonParse = `parsedJson = JSON.parse(responseText);`;
const tolerantJsonParse = 'parsedJson = JSON.parse(responseText.replace(/^```(?:json)?\\s*/i, "").replace(/\\s*```$/, "").trim());';
if (directorDist.includes(oldJsonParse)) {
  directorDist = directorDist.replace(oldJsonParse, tolerantJsonParse);
}

// Preserve Google's full error payload when request validation fails.
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

if (directorDist.includes(oldErrorParser)) {
  directorDist = directorDist.replace(oldErrorParser, detailedErrorParser);
}

// Long clip-by-clip plans can legitimately take more than three minutes. Render
// allows much longer HTTP responses, so give Gemini up to ten minutes per call.
directorDist = directorDist.replace(/AbortSignal\.timeout\(180_000\)/g, "AbortSignal.timeout(600_000)");

if (directorDist.includes("temperature: 0.35")) {
  throw new Error("Gemini Director build still contains deprecated temperature configuration.");
}
for (const forbidden of ["responseFormat:", "responseMimeType:", "responseJsonSchema:", "responseSchema:"]) {
  if (directorDist.includes(forbidden)) {
    throw new Error(`Gemini Director build still contains unsupported structured-output configuration: ${forbidden}`);
  }
}
if (!directorDist.includes("Match this JSON Schema exactly")) {
  throw new Error("Gemini Director build is missing the schema-in-prompt contract.");
}
if (directorDist.includes("AbortSignal.timeout(180_000)")) {
  throw new Error("Gemini Director build still contains the old three-minute timeout.");
}
if (!directorDist.includes("AbortSignal.timeout(600_000)")) {
  throw new Error("Gemini Director build is missing the ten-minute planning timeout.");
}

await writeFile(directorDistPath, directorDist, "utf8");
console.log("[api build] Compiled API with prompt-constrained Gemini Director JSON and a ten-minute planning timeout.");
