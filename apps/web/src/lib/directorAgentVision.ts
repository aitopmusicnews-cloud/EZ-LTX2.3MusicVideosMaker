import type { Clip } from "@mvs/shared";
import { parseDirectorVision } from "./directorVisionParser.js";

export type DirectorPlanningClip = Clip & { userDirection?: string };

function shotId(index: number, start: number, end: number): string {
  return `vision-shot-${index + 1}-${Math.round(start * 10)}-${Math.round(end * 10)}`;
}

function clampClipCount(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return Math.max(1, Math.min(80, fallback));
  return Math.max(1, Math.min(80, Math.round(value!)));
}

function splitPlanningClips(clips: DirectorPlanningClip[], desiredCount: number): DirectorPlanningClip[] {
  const counts = clips.map(() => 1);
  while (counts.reduce((sum, count) => sum + count, 0) < desiredCount) {
    let bestIndex = 0;
    let bestSpan = -1;
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index]!;
      const span = (clip.end - clip.start) / counts[index]!;
      if (span > bestSpan) {
        bestSpan = span;
        bestIndex = index;
      }
    }
    counts[bestIndex] += 1;
  }

  const result: DirectorPlanningClip[] = [];
  clips.forEach((clip, clipIndex) => {
    const segmentCount = counts[clipIndex]!;
    const duration = (clip.end - clip.start) / segmentCount;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const start = clip.start + duration * segmentIndex;
      const end = segmentIndex === segmentCount - 1 ? clip.end : clip.start + duration * (segmentIndex + 1);
      result.push({
        ...clip,
        id: shotId(result.length, start, end),
        start,
        end,
        sectionLabel: segmentCount > 1
          ? `${clip.sectionLabel || `Shot ${clipIndex + 1}`} · Clip ${segmentIndex + 1}/${segmentCount}`
          : clip.sectionLabel,
      });
    }
  });
  return result;
}

function combinePlanningClips(clips: DirectorPlanningClip[], desiredCount: number): DirectorPlanningClip[] {
  const result: DirectorPlanningClip[] = [];
  for (let groupIndex = 0; groupIndex < desiredCount; groupIndex += 1) {
    const startIndex = Math.floor((groupIndex * clips.length) / desiredCount);
    const endIndex = Math.floor(((groupIndex + 1) * clips.length) / desiredCount);
    const group = clips.slice(startIndex, Math.max(startIndex + 1, endIndex));
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const directions = group.map((clip) => clip.userDirection || clip.prompt || "").filter(Boolean);
    const labels = group.map((clip) => clip.sectionLabel).filter(Boolean);
    result.push({
      ...first,
      id: shotId(groupIndex, first.start, last.end),
      start: first.start,
      end: last.end,
      prompt: directions.join("\n\n"),
      userDirection: directions.join("\n\n"),
      sectionLabel: labels.length > 1 ? `${labels[0]} → ${labels[labels.length - 1]}` : labels[0] || `Clip ${groupIndex + 1}`,
    });
  }
  return result;
}

function rebalancePlanningClips(clips: DirectorPlanningClip[], requestedClipCount?: number): DirectorPlanningClip[] {
  if (clips.length === 0) return [];
  const desiredCount = clampClipCount(requestedClipCount, clips.length);
  if (desiredCount === clips.length) return clips;
  if (desiredCount > clips.length) return splitPlanningClips(clips, desiredCount);
  return combinePlanningClips(clips, desiredCount);
}

export function buildVisionTimelineClips(
  vision: string,
  analyzerClips: Clip[],
  requestedClipCount?: number,
): DirectorPlanningClip[] {
  const parsed = parseDirectorVision(vision);
  const baseClips: DirectorPlanningClip[] = parsed.mode === "general"
    ? analyzerClips.map((clip) => ({ ...clip }))
    : parsed.shots.map((shot, index) => ({
        id: shotId(index, shot.start, shot.end),
        start: shot.start,
        end: shot.end,
        source: "textToVideo",
        status: "empty",
        prompt: shot.rawText || shot.visualDirection,
        sectionLabel: shot.label || `Shot ${index + 1}`,
        model: "agnes-video-v2.0",
        userDirection: shot.rawText || shot.visualDirection,
      }));

  return rebalancePlanningClips(baseClips, requestedClipCount);
}

export function structuredVisionSummary(vision: string): { shotCount: number; start: number; end: number } | null {
  const parsed = parseDirectorVision(vision);
  if (parsed.mode !== "structured" || parsed.shots.length === 0) return null;
  return {
    shotCount: parsed.shots.length,
    start: parsed.shots[0]!.start,
    end: parsed.shots[parsed.shots.length - 1]!.end,
  };
}
