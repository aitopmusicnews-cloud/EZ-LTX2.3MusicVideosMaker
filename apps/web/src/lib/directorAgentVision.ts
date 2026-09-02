import type { Clip } from "@mvs/shared";
import { parseDirectorVision } from "./directorVisionParser.js";

export type DirectorPlanningClip = Clip & { userDirection?: string };

function shotId(index: number, start: number, end: number): string {
  return `vision-shot-${index + 1}-${Math.round(start * 10)}-${Math.round(end * 10)}`;
}

export function buildVisionTimelineClips(vision: string, analyzerClips: Clip[]): DirectorPlanningClip[] {
  const parsed = parseDirectorVision(vision);
  if (parsed.mode === "general") return analyzerClips.map((clip) => ({ ...clip }));

  return parsed.shots.map((shot, index) => ({
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
