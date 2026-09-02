import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchDirectorLeftRailLauncher } from "../../scripts/left-rail-tools.patch.mjs";

const source = await readFile(new URL("./LtxDirectorAgent.tsx", import.meta.url), "utf8");
const leftRailSource = await readFile(new URL("./LeftRail.tsx", import.meta.url), "utf8");
const replaceRequired = (input: string, from: string, to: string, label: string) => {
  assert.ok(input.includes(from), `missing patch anchor: ${label}`);
  return input.replace(from, to);
};
const patched = patchDirectorLeftRailLauncher(source, replaceRequired);

test("the left-rail Director parses structured Vision before choosing timeline clips", () => {
  assert.match(patched, /parseDirectorVision/);
  assert.match(patched, /buildVisionTimelineClips/);
  assert.match(patched, /const planningClips = buildVisionTimelineClips\(session\.vision, clips\)/);
});

test("the left-rail Director sends Vision-derived clips to the Director API", () => {
  assert.match(patched, /clips:\s*planningClips\.map/);
  assert.doesNotMatch(patched, /clips:\s*clips\.map\(\(clip\)/);
});

test("structured Vision replaces stale analyzer clips before plan approval", () => {
  assert.match(patched, /useStore\.setState\(\{ clips: planningClips/);
  assert.match(patched, /const SESSION_VERSION = 3/);
  assert.match(patched, /Vision override detected:/);
});

test("the Tools rail exposes an editable Director clip amount override", () => {
  assert.match(leftRailSource, /Director clip amount/);
  assert.match(leftRailSource, /DIRECTOR_CLIP_COUNT_STORAGE_KEY/);
  assert.match(leftRailSource, /min=\{1\}/);
  assert.match(leftRailSource, /max=\{80\}/);
  assert.match(leftRailSource, /placeholder="Auto"/);
});
