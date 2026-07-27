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

// Gemini 3.6 Flash requires deprecated sampling parameters such as temperature
// to be omitted. Structured output should follow the current raw REST contract.
const directorDistPath = resolve(process.cwd(), "dist/director_agent.js");
let directorDist = await readFile(directorDistPath, "utf8");

directorDist = directorDist.replace(/\s*temperature:\s*0\.35,\s*/g, "\n");

const legacyStructuredOutput = `responseMimeType: "application/json",
                responseJsonSchema: RESPONSE_SCHEMA,`;
const enumStructuredOutput = `responseFormat: {
                    text: {
                        mimeType: "APPLICATION_JSON",
                        schema: RESPONSE_SCHEMA,
                    },
                },`;
const officialStructuredOutput = `responseFormat: {
                    text: {
                        mimeType: "application/json",
                        schema: RESPONSE_SCHEMA,
                    },
                },`;

if (directorDist.includes(legacyStructuredOutput)) {
  directorDist = directorDist.replace(legacyStructuredOutput, officialStructuredOutput);
} else if (directorDist.includes(enumStructuredOutput)) {
  directorDist = directorDist.replace(enumStructuredOutput, officialStructuredOutput);
} else if (!directorDist.includes('mimeType: "application/json"')) {
  throw new Error("Could not find the compiled Gemini Director structured-output configuration.");
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

if (directorDist.includes("temperature: 0.35")) {
  throw new Error("Gemini Director build still contains deprecated temperature configuration.");
}

await writeFile(directorDistPath, directorDist, "utf8");
console.log("[api build] Compiled API with Gemini 3.6-compatible Director request.");
