import type { AudioAnalysis, Clip } from "@mvs/shared";
import type { ParsedVisionShot } from "./directorVisionParser.js";

export type DirectorShotSource = "user-vision" | "director-suggestion" | "manual";

export type DirectorShot = {
  id: string;
  label: string;
  start: number;
  end: number;
  visualDirection: string;
  cameraDirection: string;
  audioCue: string;
  onScreenText: string;
  rawText: string;
  prompt: string;
  approved: boolean;
  source: DirectorShotSource;
  technicalSplitApproved: boolean;
};

export type DirectorSection = {
  id: string;
  label: string;
  start: number;
  end: number;
  shots: DirectorShot[];
};

export type DirectorPlan = {
  mode: "structured" | "assisted";
  sections: DirectorSection[];
};

export type DirectorGenerationSegment = {
  clipId: string;
  shotId: string;
  start: number;
  end: number;
  index: number;
  count: number;
};

export type DirectorClip = Clip & {
  directorShotId?: string;
  directorSectionId?: string;
  directorSegmentIndex?: number;
  directorSegmentCount?: number;
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

function sectionForShot(shot: ParsedVisionShot, analysis: AudioAnalysis): { label: string; start: number; end: number } {
  const midpoint = shot.start + (shot.end - shot.start) / 2;
  const match = (analysis.sections ?? []).find((section) => {
    const start = section.start ?? 0;
    const end = section.end ?? analysis.duration ?? Number.POSITIVE_INFINITY;
    return midpoint >= start && midpoint < end;
  });
  return match
    ? { label: match.label || "Song section", start: match.start ?? shot.start, end: match.end ?? shot.end }
    : { label: "Custom", start: shot.start, end: shot.end };
}

export function splitDirectorShot(shot: DirectorShot, maxDuration = 5): DirectorGenerationSegment[] {
  const duration = shot.end - shot.start;
  const count = Math.max(1, Math.ceil(duration / maxDuration));
  const segmentDuration = duration / count;
  return Array.from({ length: count }, (_, index) => ({
    clipId: `${shot.id}-segment-${index + 1}`,
    shotId: shot.id,
    start: shot.start + segmentDuration * index,
    end: index === count - 1 ? shot.end : shot.start + segmentDuration * (index + 1),
    index,
    count,
  }));
}

export function buildStructuredDirectorPlan(shots: ParsedVisionShot[], analysis: AudioAnalysis): DirectorPlan {
  const sections: DirectorSection[] = [];

  shots.forEach((parsed, index) => {
    const sectionInfo = sectionForShot(parsed, analysis);
    let section = sections.find((item) => item.label === sectionInfo.label && item.start === sectionInfo.start && item.end === sectionInfo.end);
    if (!section) {
      section = {
        id: `director-section-${sections.length + 1}-${slug(sectionInfo.label)}`,
        label: sectionInfo.label,
        start: sectionInfo.start,
        end: sectionInfo.end,
        shots: [],
      };
      sections.push(section);
    }

    const duration = parsed.end - parsed.start;
    const prompt = [parsed.visualDirection, parsed.cameraDirection, parsed.audioCue, parsed.onScreenText]
      .filter(Boolean)
      .join(" ") || parsed.rawText;
    section.shots.push({
      id: `director-shot-${index + 1}`,
      label: parsed.label,
      start: parsed.start,
      end: parsed.end,
      visualDirection: parsed.visualDirection,
      cameraDirection: parsed.cameraDirection,
      audioCue: parsed.audioCue,
      onScreenText: parsed.onScreenText,
      rawText: parsed.rawText,
      prompt,
      approved: true,
      source: "user-vision",
      technicalSplitApproved: duration <= 5,
    });
  });

  return { mode: "structured", sections };
}

export function buildAssistedDirectorPlan(
  shots: Array<{ id: string; label: string; start: number; end: number; prompt: string }>,
): DirectorPlan {
  return {
    mode: "assisted",
    sections: shots.map((shot, index) => ({
      id: `director-section-${index + 1}-${slug(shot.label)}`,
      label: shot.label,
      start: shot.start,
      end: shot.end,
      shots: [{
        id: shot.id,
        label: shot.label,
        start: shot.start,
        end: shot.end,
        visualDirection: shot.prompt,
        cameraDirection: "",
        audioCue: "",
        onScreenText: "",
        rawText: shot.prompt,
        prompt: shot.prompt,
        approved: true,
        source: "director-suggestion",
        technicalSplitApproved: shot.end - shot.start <= 5,
      }],
    })),
  };
}

export function materializeDirectorClips(plan: DirectorPlan): DirectorClip[] {
  return plan.sections.flatMap((section) => section.shots.flatMap((shot) => {
    const segments = splitDirectorShot(shot);
    return segments.map((segment) => ({
      id: segment.clipId,
      start: segment.start,
      end: segment.end,
      source: segment.index === 0 ? "imageToVideo" : "continue",
      status: "empty" as const,
      prompt: shot.prompt,
      model: "agnes-video-v2.0",
      sectionLabel: section.label,
      directorShotId: shot.id,
      directorSectionId: section.id,
      directorSegmentIndex: segment.index,
      directorSegmentCount: segment.count,
    }));
  }));
}

export function updateDirectorShot(plan: DirectorPlan, shotId: string, patch: Partial<DirectorShot>): DirectorPlan {
  return {
    ...plan,
    sections: plan.sections.map((section) => ({
      ...section,
      shots: section.shots.map((shot) => shot.id === shotId ? { ...shot, ...patch } : shot),
    })),
  };
}

export function directorShot(plan: DirectorPlan, shotId: string): DirectorShot | undefined {
  return plan.sections.flatMap((section) => section.shots).find((shot) => shot.id === shotId);
}
