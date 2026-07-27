import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => signal ? rejectRun(new Error(`${command} stopped after ${signal}`)) : code !== 0 ? rejectRun(new Error(`${command} exited with code ${code}`)) : resolveRun());
  });
}

// API source is the source of truth. The previous build pipeline mutated
// server.ts and modalAI.ts with text replacements, which introduced stale
// Director calls and produced misleading TypeScript errors during deploy.
// Do not rewrite production source during the build.
console.log("[api build] Compiling current API source directly; skipped legacy Director/Modal source patches.");
await run("tsc", ["-p", "tsconfig.json"]);
