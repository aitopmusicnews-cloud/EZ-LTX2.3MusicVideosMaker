export type ContinuityApproval = { url: string; approved: boolean };
export type ContinuityShot = { clipId: string };
export type ContinuityIdentity = { id: string; name: string; url: string };
export type ContinuityAnchor = { url: string; clipId: string; kind: "shot" | "scene" };

function sharesSelectedCharacter(current: string[], candidate: string[]): boolean {
  if (!current.length) return true;
  if (!candidate.length) return false;
  const candidateIds = new Set(candidate);
  return current.some((id) => candidateIds.has(id));
}

function approvedUrl(approval?: ContinuityApproval): string | undefined {
  if (!approval?.approved) return undefined;
  const url = approval.url.trim();
  return url || undefined;
}

function approvedAnchorForClip(
  clipId: string,
  shotApprovals: Record<string, ContinuityApproval | undefined>,
  sceneApprovals: Record<string, ContinuityApproval | undefined>,
): ContinuityAnchor | undefined {
  const shotUrl = approvedUrl(shotApprovals[clipId]);
  if (shotUrl) return { url: shotUrl, clipId, kind: "shot" };
  const sceneUrl = approvedUrl(sceneApprovals[clipId]);
  if (sceneUrl) return { url: sceneUrl, clipId, kind: "scene" };
  return undefined;
}

export function findPriorApprovedProjectAnchor(input: {
  currentClipId: string;
  shots: ContinuityShot[];
  shotApprovals: Record<string, ContinuityApproval | undefined>;
  sceneApprovals: Record<string, ContinuityApproval | undefined>;
}): ContinuityAnchor | undefined {
  const currentIndex = input.shots.findIndex((shot) => shot.clipId === input.currentClipId);
  if (currentIndex <= 0) return undefined;
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const anchor = approvedAnchorForClip(input.shots[index]!.clipId, input.shotApprovals, input.sceneApprovals);
    if (anchor) return anchor;
  }
  return undefined;
}

export function findPriorApprovedContinuityAnchor(input: {
  currentClipId: string;
  shots: ContinuityShot[];
  shotApprovals: Record<string, ContinuityApproval | undefined>;
  sceneApprovals: Record<string, ContinuityApproval | undefined>;
  characterSelections: Record<string, string[]>;
}): ContinuityAnchor | undefined {
  const currentIndex = input.shots.findIndex((shot) => shot.clipId === input.currentClipId);
  if (currentIndex <= 0) return undefined;
  const currentCharacters = input.characterSelections[input.currentClipId] ?? [];

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const clipId = input.shots[index]!.clipId;
    const candidateCharacters = input.characterSelections[clipId] ?? [];
    if (!sharesSelectedCharacter(currentCharacters, candidateCharacters)) continue;
    const anchor = approvedAnchorForClip(clipId, input.shotApprovals, input.sceneApprovals);
    if (anchor) return anchor;
  }
  return undefined;
}

export function buildStrictContinuityInstruction(input: {
  identities: ContinuityIdentity[];
  continuityAnchorUrl?: string;
  projectAnchorUrl?: string;
  referenceUrls: string[];
}): string {
  const characterNames = input.identities.map((identity) => identity.name).filter(Boolean).join(", ");
  const identityRule = input.identities.length
    ? `For recurring character${input.identities.length === 1 ? "" : "s"}${characterNames ? ` (${characterNames})` : ""}, preserve the exact approved identity: skin tone/complexion, facial features, hair, body proportions, age presentation, wardrobe, jewelry, and accessories.`
    : "Preserve all recurring visual identities exactly as previously approved.";

  const characterAnchorIndex = input.continuityAnchorUrl ? input.referenceUrls.indexOf(input.continuityAnchorUrl) : -1;
  const projectAnchorIndex = input.projectAnchorUrl ? input.referenceUrls.indexOf(input.projectAnchorUrl) : -1;
  const characterAnchorRule = characterAnchorIndex >= 0
    ? `Reference image ${characterAnchorIndex + 1} is the approved character continuity anchor. Match the selected recurring character to that anchor without changing identity, skin tone/complexion, hair, body proportions, wardrobe, jewelry, or accessories.`
    : "Match each selected recurring character only to their approved identity references.";
  const projectAnchorRule = projectAnchorIndex >= 0
    ? `Reference image ${projectAnchorIndex + 1} is the approved project continuity anchor for recurring wardrobe, props, equipment, vehicles, instruments, set dressing, and other recurring objects. Do not copy people from the project continuity anchor unless those people are also selected character identities for this shot.`
    : "Preserve recurring wardrobe, props, equipment, vehicles, instruments, set dressing, and other recurring objects from approved project continuity references.";

  return `STRICT CONTINUITY LOCK. ${identityRule} Never lighten, darken, recolor, or otherwise change a recurring character's skin tone or complexion. ${characterAnchorRule} ${projectAnchorRule} Do not replace, remove, redesign, or recolor recurring wardrobe, props, equipment, vehicles, instruments, or set details unless the current script explicitly requires that change. Camera angle, pose, action, and location may change only as directed by the current script.`;
}

export function buildStrictVideoContinuityInstruction(identities: ContinuityIdentity[]): string {
  const characterNames = identities.map((identity) => identity.name).filter(Boolean).join(", ");
  const identityRule = identities.length
    ? `Keep recurring character${identities.length === 1 ? "" : "s"}${characterNames ? ` (${characterNames})` : ""} matched exactly to the approved shot image: skin tone/complexion, face, hair, body proportions, wardrobe, jewelry, and accessories.`
    : "Keep all recurring visual identities matched exactly to the approved shot image.";
  return `STRICT VIDEO CONTINUITY LOCK. The approved shot image is the continuity seed and source of truth. ${identityRule} Preserve the same props, equipment, vehicles, instruments, and recurring set details in every frame and every technical segment. Never change a recurring character's skin tone or complexion, and never substitute a different-looking person. Do not replace, remove, redesign, or recolor recurring wardrobe, props, or equipment unless the current script explicitly requires that change.`;
}
