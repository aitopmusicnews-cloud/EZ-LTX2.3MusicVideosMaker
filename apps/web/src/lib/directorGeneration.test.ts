import test from "node:test";
import assert from "node:assert/strict";
import type { Clip } from "@mvs/shared";
import type { DirectorPlan } from "./directorPlan.js";
import { selectDirectorGenerationClips, countDirectorGenerationRequests } from "./directorGeneration.js";

const shot = (id: string, start: number, end: number) => ({
  id,
  label: id,
  start,
  end,
  visualDirection: id,
  cameraDirection: "",
  audioCue: "",
  onScreenText: "",
  rawText: id,
  prompt: id,
  approved: true,
  source: "user-vision" as const,
  technicalSplitApproved: true,
});

const plan: DirectorPlan = {
  mode: "structured",
  sections: [{
    id: "section-chorus",
    label: "Chorus",
    start: 0,
    end: 10,
    shots: [shot("shot-a", 0, 5), shot("shot-b", 5, 10)],
  }],
};

const clips: Clip[] = [
  { id: "shot-a-segment-1", start: 0, end: 5, source: "imageToVideo", status: "ready", videoUrl: "https://example.com/a.mp4", directorShotId: "shot-a", directorSectionId: "section-chorus", directorSegmentIndex: 0, directorSegmentCount: 1 },
  { id: "shot-b-segment-1", start: 5, end: 10, source: "imageToVideo", status: "empty", directorShotId: "shot-b", directorSectionId: "section-chorus", directorSegmentIndex: 0, directorSegmentCount: 1 },
];

test("Generate Section skips already-ready media", () => {
  const selected = selectDirectorGenerationClips(plan, clips, { type: "section", sectionId: "section-chorus" });
  assert.deepEqual(selected.map((clip) => clip.id), ["shot-b-segment-1"]);
  assert.equal(countDirectorGenerationRequests(plan, clips, { type: "section", sectionId: "section-chorus" }), 1);
});

test("Regenerate Shot selects ready media only when explicitly requested", () => {
  const normal = selectDirectorGenerationClips(plan, clips, { type: "shot", shotId: "shot-a" });
  const regenerate = selectDirectorGenerationClips(plan, clips, { type: "shot", shotId: "shot-a" }, true);
  assert.equal(normal.length, 0);
  assert.deepEqual(regenerate.map((clip) => clip.id), ["shot-a-segment-1"]);
});
