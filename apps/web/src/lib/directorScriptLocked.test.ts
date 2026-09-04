import assert from "node:assert/strict";
import test from "node:test";

import { buildScriptLockedShots, materializeScriptLockedTimeline, migrateLegacyDirectorAssets } from "./directorScriptLocked.js";


test("timecoded Vision yields exact source shots", () => {
  const shots = buildScriptLockedShots(
    `00:12–00:18\nShot 1: Character 1 walks to the window.\nCamera: track right.\n00:18–00:23\nShot 2: Character 2 remains at the piano.`,
    {},
  );
  assert.equal(shots.length, 2);
  assert.deepEqual([shots[0]!.start, shots[0]!.end], [12, 18]);
  assert.deepEqual([shots[1]!.start, shots[1]!.end], [18, 23]);
  assert.match(shots[0]!.sourceText, /Character 1 walks to the window/i);
  assert.match(shots[0]!.cameraDirection, /track right/i);
});


test("Script-Locked clip IDs exactly match structured Vision timeline materialization", () => {
  const shots = buildScriptLockedShots(
    `00:12–00:18\nShot 1: Character 1 walks to the window.\n00:18–00:23\nShot 2: Character 2 remains at the piano.`,
    {},
  );
  assert.deepEqual(shots.map((shot) => shot.clipId), [
    "vision-shot-1-120-180",
    "vision-shot-2-180-230",
  ]);
});


test("materialization uses exact Vision clips and preserves matching ready media", () => {
  const vision = `00:12–00:18\nShot 1: Character 1 walks to the window.\n00:18–00:23\nShot 2: Character 2 remains at the piano.`;
  const existing = [
    {
      id: "vision-shot-1-120-180",
      start: 12,
      end: 18,
      source: "imageToVideo" as const,
      status: "ready" as const,
      videoUrl: "/existing.mp4",
      prompt: "legacy generic prompt",
      seedImageUrl: "/approved-shot.png",
    },
    {
      id: "analyzer-old",
      start: 0,
      end: 5,
      source: "textToVideo" as const,
      status: "empty" as const,
    },
  ];

  const clips = materializeScriptLockedTimeline(vision, existing as any);
  assert.deepEqual(clips.map((clip) => clip.id), [
    "vision-shot-1-120-180",
    "vision-shot-2-180-230",
  ]);
  assert.equal(clips[0]!.videoUrl, "/existing.mp4");
  assert.equal(clips[0]!.status, "ready");
  assert.equal(clips[0]!.prompt, undefined);
  assert.equal(clips[1]!.status, "empty");
});


test("migration retains approved media but never legacy generic prompt", () => {
  const migrated = migrateLegacyDirectorAssets({
    shotApprovals: { "vision-shot-1": { url: "/old.png", approved: true } },
    sceneApprovals: { "vision-shot-1": { url: "/scene.png", approved: true } },
    sectionApprovals: { "vision-shot-1": { url: "/old.mp4", approved: true } },
    approvedCharacterIds: ["char-1"],
    characterSelections: { "vision-shot-1": ["char-1"] },
    legacyPlan: { shots: [{ clipId: "vision-shot-1", prompt: "generic cinematic reinterpretation" }] },
  });

  assert.equal(migrated.shotApprovals["vision-shot-1"]!.url, "/old.png");
  assert.equal(migrated.sceneApprovals["vision-shot-1"]!.url, "/scene.png");
  assert.equal(migrated.sectionApprovals["vision-shot-1"]!.url, "/old.mp4");
  assert.deepEqual(migrated.approvedCharacterIds, ["char-1"]);
  assert.deepEqual(migrated.characterSelections["vision-shot-1"], ["char-1"]);
  assert.equal(migrated.compiledByClip["vision-shot-1"], undefined);
});
