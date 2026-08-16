import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: webRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (signal) rejectRun(new Error(`${command} stopped after ${signal}`));
      else if (code !== 0) rejectRun(new Error(`${command} exited with code ${code}`));
      else resolveRun();
    });
  });
}

await run("tsc", ["--noEmit"]);
await run("vite", ["build"]);
