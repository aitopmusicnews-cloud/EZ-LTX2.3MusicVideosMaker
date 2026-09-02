import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./AutoDirector.tsx", import.meta.url), "utf8");

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end}`);
  return source.slice(from, to);
}

test("Director v3 parses the user's Vision into an authoritative plan", () => {
  assert.match(source, /DIRECTOR_VERSION\s*=\s*3/);
  assert.match(source, /parseDirectorVision/);
  assert.match(source, /buildStructuredDirectorPlan/);
});

test("production exposes explicit shot, section, and approved-all generation handlers", () => {
  assert.match(source, /const generateShot\s*=/);
  assert.match(source, /const generateSection\s*=/);
  assert.match(source, /const generateAllApproved\s*=/);
  assert.doesNotMatch(source, /const startProduction\s*=/);
});

test("final render remains assembly-only", () => {
  const render = between("const renderFinal = async", "const restartDirector");
  assert.doesNotMatch(render, /enqueueGeneration/);
});
