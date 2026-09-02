import test from "node:test";
import assert from "node:assert/strict";
import type { Clip } from "@mvs/shared";
import { parseDirectorVision, parseTimecode } from "./directorVisionParser.js";
import { buildVisionTimelineClips } from "./directorAgentVision.js";

const SAMPLE = `
0:00 – 0:06 Shot 1: Extreme Close-Up (ECU)
Slow push-in on a stove clock glowing 2:15 in the dark.
0:06 – 0:14 Shot 2: Low-Angle Tracking
Gliding camera tracking behind her pointed stiletto boots.
0:14 – 0:22 Shot 3: Medium Waist-Up
She leans against the marble island.
`;

const COMPACT_EIGHT_SHOTS = `0:00 – 0:06Shot 1: Extreme Close-Up (ECU)Slow push-in on a stove clock glowing 2:15 in the dark.0:06 – 0:14Shot 2: Low-Angle TrackingGliding camera tracking behind her pointed stiletto boots and baggy cargo pants.0:14 – 0:22Shot 3: Medium Waist-UpShe leans against the marble island, adjusting the collar of her oversized leather bomber jacket.0:22 – 0:28Shot 4: Dutch Angle Close-UpCamera tilts slightly off-axis. Macro shot of her manicured hand tracing a brass key.0:28 – 0:40Shot 5: Performance Hero Shot (The Drop)Dynamic slow-push toward her face under glowing amber rim light.0:40 – 0:50Shot 6: Rapid Beat-Cut MontageThree quick cuts timed to snare hits.0:50 – 0:56Shot 7: Slow Pull-BackCamera drifts backward as she turns toward the floor-to-ceiling glass.0:56 – 1:00Shot 8: Outro & End-CardRack focus and minimalist luxury title card fades in.`;

const TWO_ANALYZER_CLIPS: Clip[] = [
  { id: "analyzer-1", start: 0, end: 30, source: "continue", status: "empty", sectionLabel: "Verse" },
  { id: "analyzer-2", start: 30, end: 60, source: "continue", status: "empty", sectionLabel: "Chorus" },
];

test("parseTimecode converts mm:ss to seconds", () => {
  assert.equal(parseTimecode("1:00"), 60);
  assert.equal(parseTimecode("0:14"), 14);
  assert.equal(parseTimecode("bad"), null);
});

test("structured timecoded Vision preserves explicit shot count and timing", () => {
  const parsed = parseDirectorVision(SAMPLE);
  assert.equal(parsed.mode, "structured");
  if (parsed.mode !== "structured") return;
  assert.equal(parsed.shots.length, 3);
  assert.deepEqual(parsed.shots.map((shot) => [shot.start, shot.end]), [[0, 6], [6, 14], [14, 22]]);
  assert.equal(parsed.shots[0]!.label, "Shot 1: Extreme Close-Up (ECU)");
  assert.match(parsed.shots[0]!.rawText, /stove clock glowing 2:15/i);
});

test("compact clipboard table preserves all eight user shots", () => {
  const parsed = parseDirectorVision(COMPACT_EIGHT_SHOTS);
  assert.equal(parsed.mode, "structured");
  if (parsed.mode !== "structured") return;
  assert.equal(parsed.shots.length, 8);
  assert.deepEqual(parsed.shots.map((shot) => [shot.start, shot.end]), [
    [0, 6], [6, 14], [14, 22], [22, 28], [28, 40], [40, 50], [50, 56], [56, 60],
  ]);
  assert.equal(parsed.shots[0]!.label, "Shot 1");
  assert.match(parsed.shots[0]!.visualDirection, /Extreme Close-Up.*stove clock/is);
});

test("structured Vision overrides a two-clip analyzer with eight creative shots", () => {
  const planningClips = buildVisionTimelineClips(COMPACT_EIGHT_SHOTS, TWO_ANALYZER_CLIPS);
  assert.equal(planningClips.length, 8);
  assert.deepEqual(planningClips.map((clip) => [clip.start, clip.end]), [
    [0, 6], [6, 14], [14, 22], [22, 28], [28, 40], [40, 50], [50, 56], [56, 60],
  ]);
  assert.match(planningClips[0]!.prompt ?? "", /stove clock/i);
});

test("general prose stays general and keeps analyzer clips", () => {
  assert.deepEqual(parseDirectorVision("Luxury rooftop performance at night"), {
    mode: "general",
    rawText: "Luxury rooftop performance at night",
  });
  assert.deepEqual(buildVisionTimelineClips("Luxury rooftop performance at night", TWO_ANALYZER_CLIPS), TWO_ANALYZER_CLIPS);
});
