import type { Clip } from "@mvs/shared";
import type { DirectorPlan, DirectorClip } from "./directorPlan.js";

export type DirectorGenerationScope =
  | { type: "shot"; shotId: string }
  | { type: "section"; sectionId: string }
  | { type: "all" };

function eligibleShotIds(plan: DirectorPlan, scope: DirectorGenerationScope): Set<string> {
  const ids = new Set<string>();
  for (const section of plan.sections) {
    if (scope.type === "section" && section.id !== scope.sectionId) continue;
    for (const shot of section.shots) {
      if (scope.type === "shot" && shot.id !== scope.shotId) continue;
      if (!shot.approved) continue;
      const requiresSplit = shot.end - shot.start > 5;
      if (requiresSplit && !shot.technicalSplitApproved) continue;
      ids.add(shot.id);
    }
  }
  return ids;
}

export function selectDirectorGenerationClips(
  plan: DirectorPlan,
  clips: Clip[],
  scope: DirectorGenerationScope,
  regenerate = false,
): Clip[] {
  const shotIds = eligibleShotIds(plan, scope);
  return clips.filter((raw) => {
    const clip = raw as DirectorClip;
    if (!clip.directorShotId || !shotIds.has(clip.directorShotId)) return false;
    if (clip.status === "queued" || clip.status === "generating") return false;
    const ready = clip.status === "ready" && !!clip.videoUrl;
    if (ready && !regenerate) return false;
    return true;
  });
}

export function countDirectorGenerationRequests(
  plan: DirectorPlan,
  clips: Clip[],
  scope: DirectorGenerationScope,
  regenerate = false,
): number {
  return selectDirectorGenerationClips(plan, clips, scope, regenerate).length;
}
