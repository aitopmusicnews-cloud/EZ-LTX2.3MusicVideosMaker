import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const localPlanModule = await import("./director_local_plan.js").catch(() => null);

test("Director can build a local Vision-first plan when Gemini is unavailable", () => {
  assert.ok(localPlanModule, "director_local_plan module must exist");
  const plan = localPlanModule!.buildLocalDirectorPlan({
    vision: "Neon rooftop performance at night",
    mustInclude: "Keep the red suit and skyline",
    avoid: "No crowd",
    characterRequired: true,
    clips: [
      { id: "shot-1", start: 0, end: 6, sectionLabel: "Intro", userDirection: "Wide rooftop reveal, slow push toward artist in red suit" },
      { id: "shot-2", start: 6, end: 12, sectionLabel: "Verse", userDirection: "Medium performance shot, orbit camera clockwise" },
    ],
  }, [
    { id: "store-character", kind: "character", anchorUrl: "https://example.com/artist.jpg" },
  ]);

  assert.equal(plan.agentModel, "local-vision-fallback");
  assert.equal(plan.shots.length, 2);
  assert.equal(plan.shots[0]?.clipId, "shot-1");
  assert.equal(plan.shots[0]?.start, 0);
  assert.equal(plan.shots[0]?.end, 6);
  assert.match(plan.shots[0]?.prompt ?? "", /Wide rooftop reveal/i);
  assert.equal(plan.shots[0]?.conditioningReferenceId, "store-character");
  assert.match(plan.shots[1]?.prompt ?? "", /orbit camera clockwise/i);
});

test("local fallback preserves one shot per exact supplied clip", () => {
  assert.ok(localPlanModule, "director_local_plan module must exist");
  const clips = Array.from({ length: 8 }, (_, index) => ({
    id: `shot-${index + 1}`,
    start: index * 7.5,
    end: (index + 1) * 7.5,
    sectionLabel: `Shot ${index + 1}`,
    userDirection: `Direction ${index + 1}`,
  }));
  const plan = localPlanModule!.buildLocalDirectorPlan({
    vision: "Use all eight shots exactly",
    mustInclude: "",
    avoid: "",
    characterRequired: false,
    clips,
  }, []);

  assert.equal(plan.shots.length, 8);
  assert.deepEqual(plan.shots.map((shot: any) => [shot.clipId, shot.start, shot.end]), clips.map((clip) => [clip.id, clip.start, clip.end]));
});

test("API build preserves userDirection and falls back locally after Gemini exhaustion", async () => {
  const buildSource = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(buildSource, /userDirection/);
  assert.match(buildSource, /buildLocalDirectorPlan/);
  assert.match(buildSource, /local-vision-fallback|Gemini.*local/i);
});
