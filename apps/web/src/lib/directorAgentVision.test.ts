import test from "node:test";
import assert from "node:assert/strict";
import { buildVisionTimelineClips } from "./directorAgentVision.js";

const VISION = `
0:00 – 0:10 Shot 1: Intro
Slow push toward the artist in a dark kitchen.
0:10 – 0:20 Shot 2: Verse
Low-angle tracking as she crosses the room.
0:20 – 0:30 Shot 3: Chorus
Performance hero shot under flashing practical lights.
0:30 – 0:40 Shot 4: Bridge
Dutch-angle close-up as the energy turns tense.
`;

const analyzerClips = [
  { id: "a", start: 0, end: 20, source: "textToVideo", status: "empty" as const },
  { id: "b", start: 20, end: 40, source: "textToVideo", status: "empty" as const },
];

test("editable clip count can expand a structured Vision without losing its directions", () => {
  const clips = buildVisionTimelineClips(VISION, analyzerClips, 8);
  assert.equal(clips.length, 8);
  assert.equal(clips[0]!.start, 0);
  assert.equal(clips.at(-1)!.end, 40);
  assert.match(clips[0]!.userDirection ?? "", /dark kitchen/i);
  assert.match(clips[2]!.userDirection ?? "", /low-angle tracking/i);
});

test("editable clip count can reduce a structured Vision by combining adjacent directions", () => {
  const clips = buildVisionTimelineClips(VISION, analyzerClips, 2);
  assert.equal(clips.length, 2);
  assert.equal(clips[0]!.start, 0);
  assert.equal(clips[0]!.end, 20);
  assert.match(clips[0]!.userDirection ?? "", /dark kitchen/i);
  assert.match(clips[0]!.userDirection ?? "", /low-angle tracking/i);
  assert.equal(clips[1]!.start, 20);
  assert.equal(clips[1]!.end, 40);
});

test("clip count is clamped to the supported 1 to 80 range", () => {
  assert.equal(buildVisionTimelineClips(VISION, analyzerClips, 0).length, 1);
  assert.equal(buildVisionTimelineClips(VISION, analyzerClips, 999).length, 80);
});
