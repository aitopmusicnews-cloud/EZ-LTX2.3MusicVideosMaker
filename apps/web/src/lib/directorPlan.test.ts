import test from "node:test";
import assert from "node:assert/strict";
import { buildStructuredDirectorPlan, splitDirectorShot, materializeDirectorClips } from "./directorPlan.js";

const parsedShots = [
  { label: "Shot 1", start: 0, end: 6, rawText: "Clock", visualDirection: "Clock", cameraDirection: "", audioCue: "", onScreenText: "" },
  { label: "Shot 2", start: 6, end: 14, rawText: "Tracking", visualDirection: "Tracking", cameraDirection: "", audioCue: "", onScreenText: "" },
];

const analysis = {
  duration: 14,
  sections: [
    { label: "Intro", start: 0, end: 6 },
    { label: "Verse 1", start: 6, end: 14 },
  ],
};

test("structured plan keeps the exact creative shot count", () => {
  const plan = buildStructuredDirectorPlan(parsedShots, analysis);
  assert.equal(plan.sections.flatMap((section) => section.shots).length, 2);
  assert.equal(plan.sections[0]!.shots[0]!.source, "user-vision");
});

test("a 12 second creative shot remains one shot but has three technical segments", () => {
  const shot = {
    id: "shot-long",
    label: "Hero",
    start: 0,
    end: 12,
    visualDirection: "Hero performance",
    cameraDirection: "Slow push",
    audioCue: "chorus",
    onScreenText: "OFF-HOURS",
    rawText: "Hero performance",
    prompt: "Hero performance",
    approved: true,
    source: "user-vision" as const,
    technicalSplitApproved: false,
  };
  const segments = splitDirectorShot(shot);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((segment) => [segment.start, segment.end]), [[0, 4], [4, 8], [8, 12]]);
});

test("materialized clips retain creative-shot identity", () => {
  const plan = buildStructuredDirectorPlan(parsedShots, analysis);
  const clips = materializeDirectorClips(plan);
  assert.ok(clips.length >= 2);
  assert.equal(clips[0]!.directorShotId, plan.sections[0]!.shots[0]!.id);
  assert.equal(clips[0]!.directorSegmentIndex, 0);
});
