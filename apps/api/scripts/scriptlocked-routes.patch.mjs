import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const serverDistPath = resolve(process.cwd(), "dist/server.js");
let serverDist = await readFile(serverDistPath, "utf8");

const marker = 'registerScriptLockedDirectorRoutes(app)';
if (!serverDist.includes(marker)) {
  const healthAnchor = 'app.get("/health", async () => ({ ok: true }));';
  if (!serverDist.includes(healthAnchor)) {
    throw new Error("Could not find compiled API health-route anchor for Script-Locked Director registration.");
  }
  const registration = `${healthAnchor}\nconst { registerScriptLockedDirectorRoutes } = await import("./director_scriptlocked_routes.js");\nawait registerScriptLockedDirectorRoutes(app);`;
  serverDist = serverDist.replace(healthAnchor, registration);
}

if (!serverDist.includes(marker)) {
  throw new Error("Compiled API is missing Script-Locked Director route registration.");
}
await writeFile(serverDistPath, serverDist, "utf8");
console.log("[api build] Registered Script-Locked Director compile/edit routes.");
