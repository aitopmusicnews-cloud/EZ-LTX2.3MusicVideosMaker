import test from "node:test";
import assert from "node:assert/strict";
import { parseDirectorVision, parseTimecode } from "./directorVisionParser.js";

const SAMPLE = `
0:00 – 0:06 Shot 1: Extreme Close-Up (ECU)
Slow push-in on a stove clock glowing 2:15 in the dark.
0:06 – 0:14 Shot 2: Low-Angle Tracking
Gliding camera tracking behind her pointed stiletto boots.
0:14 – 0:22 Shot 3: Medium Waist-Up
She leans against the marble island.
`;

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

test("general prose stays general", () => {
  assert.deepEqual(parseDirectorVision("Luxury rooftop performance at night"), {
    mode: "general",
    rawText: "Luxury rooftop performance at night",
  });
});
