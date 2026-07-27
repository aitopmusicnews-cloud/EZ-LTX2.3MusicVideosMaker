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

// Gemini 3.6 Flash generateContent uses responseFormat for structured output.
// In the raw REST proto, TextResponseFormat.mimeType is an enum, so JSON must
// be sent as APPLICATION_JSON rather than the literal string application/json.
const directorDistPath = resolve(process.cwd(), "dist/director_agent.js");
let directorDist = await readFile(directorDistPath, "utf8");

const legacyConfig = `responseMimeType: "application/json",
                responseJsonSchema: RESPONSE_SCHEMA,`;
const currentConfig = `responseFormat: {
                    text: {
                        mimeType: "APPLICATION_JSON",
                        schema: RESPONSE_SCHEMA,
                    },
                },`;

if (directorDist.includes(legacyConfig)) {
  directorDist = directorDist.replace(legacyConfig, currentConfig);
} else if (!directorDist.includes('mimeType: "APPLICATION_JSON"')) {
  throw new Error("Could not find the compiled Gemini Director structured-output configuration.");
}

// Preserve Google's error details. The API often places the useful field-level
// reason in error.details while error.message is only "Request contains an invalid argument.".
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

await writeFile(directorDistPath, directorDist, "utf8");
console.log("[api build] Compiled API with Gemini 3.6 responseFormat structured output.");
