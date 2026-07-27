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

// Gemini 3.6 Flash still accepts the legacy generateContent responseSchema path,
// but that path expects Google's OpenAPI Schema shape rather than raw JSON Schema.
// Keep TypeScript source as the source of truth and normalize only the compiled
// Director request so Render sends nullable fields and enum types correctly.
const directorDistPath = resolve(process.cwd(), "dist/director_agent.js");
let directorDist = await readFile(directorDistPath, "utf8");

const callGeminiAnchor = "async function callGemini(parts, model) {";
const legacySchemaHelper = `function toLegacyResponseSchema(value) {
    if (Array.isArray(value))
        return value.map((item) => toLegacyResponseSchema(item));
    if (!value || typeof value !== "object")
        return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === "additionalProperties")
            continue;
        if (key === "type" && Array.isArray(child)) {
            const nonNullType = child.find((item) => item !== "null");
            if (nonNullType)
                result.type = String(nonNullType).toUpperCase();
            if (child.includes("null"))
                result.nullable = true;
            continue;
        }
        if (key === "type" && typeof child === "string") {
            result.type = child.toUpperCase();
            continue;
        }
        result[key] = toLegacyResponseSchema(child);
    }
    return result;
}

`;

if (!directorDist.includes("function toLegacyResponseSchema(value)")) {
  if (!directorDist.includes(callGeminiAnchor)) {
    throw new Error("Could not find the compiled Gemini Director call anchor.");
  }
  directorDist = directorDist.replace(callGeminiAnchor, legacySchemaHelper + callGeminiAnchor);
}

const jsonSchemaConfig = "responseJsonSchema: RESPONSE_SCHEMA,";
const legacySchemaConfig = "responseSchema: toLegacyResponseSchema(RESPONSE_SCHEMA),";
if (directorDist.includes(jsonSchemaConfig)) {
  directorDist = directorDist.replace(jsonSchemaConfig, legacySchemaConfig);
} else if (!directorDist.includes(legacySchemaConfig)) {
  throw new Error("Could not find the compiled Gemini Director structured-output configuration.");
}

await writeFile(directorDistPath, directorDist, "utf8");
console.log("[api build] Compiled API and normalized Gemini Director structured output for generateContent.");
