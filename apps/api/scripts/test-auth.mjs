import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, "..");
const outputDirectory = resolve(apiDirectory, ".auth-test-dist");

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: apiDirectory,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectRun(new Error(`${command} stopped after signal ${signal}`));
        return;
      }

      if (code !== 0) {
        rejectRun(new Error(`${command} exited with code ${code}`));
        return;
      }

      resolveRun();
    });
  });
}

await rm(outputDirectory, { recursive: true, force: true });

try {
  await run("tsc", ["-p", "tsconfig.auth-test.json"]);
  await run(process.execPath, [
    "--test",
    ".auth-test-dist/auth.test.js",
  ]);
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
