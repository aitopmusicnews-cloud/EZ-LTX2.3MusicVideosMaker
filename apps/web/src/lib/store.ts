import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AudioAnalysis, AudioSection, Clip } from "@mvs/shared";
import { ProjectSnapshot } from "@mvs/shared";
import type { Job } from "./scheduler.js";
import { getWs } from "./wavesurfer-ref.js";

export const MAX_CLIP_LEN = 5;
export const MIN_CLIP_LEN = 0.5;

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 32;
export const ZOOM_STEP = 1.5;

// Bump the persistence namespace when switching backend workspaces or making
// incompatible project-state changes. This prevents a fresh deployment from
// restoring stale state that references assets/jobs from an older workspace.
const PERSIST_KEY = "mvs-project-v2";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function nearestBeat(t: number, beats: number[]): number | null {
  if (!beats.length) return null;
  let best = beats[0]!;
  let bestDist = Math.abs(t - best);
  for (const b of beats) {
    const d = Math.abs(t - b);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

function nearestBeatInRange(t: number, beats: number[], lo: number, hi: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const b of beats) {
    if (b <= lo || b >= hi) continue;
    const d = Math.abs(t - b);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

function newClipId(): string {
  return `clip-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeLtxClips(clips: Clip[]): Clip[] {
  return clips.map((clip, index) => {
    if (clip.status === "ready" && clip.source === "upload") return clip;
    let source: string;
    if (clip.source === "imageToVideo" || clip.source === "archetype") source = "imageToVideo";
    else if (clip.source === "continue" && index > 0) source = "continue";
    else source = "textToVideo";
    return { ...clip, source, model: "ltx-video" };
  });
}

function normalizeAnalysis(analysis: AudioAnalysis | null | undefined): AudioAnalysis | null {
  if (!analysis) return null;
  return {
    ...analysis,
    sections: Array.isArray(analysis.sections) ? analysis.sections : [],
    beats: Array.isArray(analysis.beats) ? analysis.beats : [],
  };
}

function subdivideSection(section: AudioSection, beats: number[]): Clip[] {
  const len = section.end - section.start;
  if (len <= MAX_CLIP_LEN) {
    return [
      {
        id: newClipId(),
        start: section.start,
        end: section.end,
        source: "continue",
        status: "empty",
      },
    ];
  }
  const count = Math.ceil(len / MAX_CLIP_LEN);
  const idealLen = len / count;
  const clips: Clip[] = [];
  let cursor = section.start;
  for (let i = 0; i < count - 1; i++) {
    const target = section.start + idealLen * (i + 1);
    const lo = cursor + MIN_CLIP_LEN;
    const hi = section.end - MIN_CLIP_LEN;
    const candidates = beats.filter((b) => b >= lo && b <= hi);
    const cut = candidates.length ? nearestBeat(target, candidates)! : Math.min(hi, Math.max(lo, target));
    clips.push({
      id: newClipId(),
      start: cursor,
      end: cut,
      source: "continue",
      status: "empty",
    });
    cursor = cut;
  }
  clips.push({
    id: newClipId(),
    start: cursor,
    end: section.end,
    source: "continue",
    status: "empty",
  });
  return clips;
}

// State, emptyState, and store implementation continue below unchanged.
