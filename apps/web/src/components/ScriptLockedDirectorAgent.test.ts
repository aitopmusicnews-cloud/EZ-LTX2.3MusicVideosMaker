import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ScriptLockedDirectorAgent.tsx", import.meta.url), "utf8");


test("Script-Locked UI centers exact source and Agnes instructions", () => {
  assert.match(source, /Script locked/);
  assert.match(source, /Exact source script/);
  assert.match(source, /Agnes instruction/);
  assert.match(source, /Compile Agnes instructions/);
  assert.doesNotMatch(source, /Cinematic scene board|Approve treatment|color palette/i);
});


test("general prose requires an explicit Assisted Director handoff", () => {
  assert.match(source, /Script-Locked Director needs timecoded shots/);
  assert.match(source, /Open Assisted Director/);
  assert.match(source, /mvs-open-assisted-director/);
});


test("compile and edit paths do not call media providers", () => {
  assert.match(source, /compileScriptLocked/);
  assert.match(source, /editScriptLocked/);
  assert.doesNotMatch(source, /startTextToImage|pollTask|enqueueGeneration/);
});
