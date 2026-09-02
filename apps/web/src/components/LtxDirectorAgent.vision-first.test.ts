import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./LtxDirectorAgent.tsx", import.meta.url), "utf8");

test("the left-rail Director parses structured Vision before choosing timeline clips", () => {
  assert.match(source, /parseDirectorVision/);
  assert.match(source, /buildVisionTimelineClips/);
  assert.match(source, /const planningClips = buildVisionTimelineClips\(session\.vision, clips\)/);
});

test("the left-rail Director sends Vision-derived clips to the Director API", () => {
  assert.match(source, /clips:\s*planningClips\.map/);
  assert.doesNotMatch(source, /clips:\s*clips\.map\(\(clip\)/);
});
