import { spawn } from "node:child_process";

const server = spawn(process.execPath, ["dist/server.js"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (!server.killed) server.kill(signal);
  });
}

server.on("error", (error) => {
  console.error("[API Startup] Could not launch dist/server.js:", error);
  process.exitCode = 1;
});

server.on("exit", (code, signal) => {
  if (signal) {
    console.log(`[API Startup] Server exited after ${signal}.`);
    process.exitCode = 0;
  } else {
    process.exitCode = code ?? 0;
  }
});
