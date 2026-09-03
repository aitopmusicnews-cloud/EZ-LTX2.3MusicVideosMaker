export type DirectorVisualReference = {
  id: string;
  name?: string;
  url?: string;
  anchorUrl?: string;
};

export type DirectorCharacterIdentity = {
  id: string;
  name: string;
  url: string;
};

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of urls) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

export function resolveCharacterIdentities(
  selectionIds: string[],
  references: DirectorVisualReference[],
  storeCharacterUrl: string | null,
): DirectorCharacterIdentity[] {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const result: DirectorCharacterIdentity[] = [];
  const byUrl = new Map<string, number>();

  for (const id of selectionIds) {
    const reference = id === "store-character" ? undefined : byId.get(id);
    const rawUrl = id === "store-character"
      ? storeCharacterUrl
      : reference?.anchorUrl ?? reference?.url;
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!url) continue;

    const identity: DirectorCharacterIdentity = {
      id,
      name: id === "store-character" ? "Approved project character" : reference?.name?.trim() || id,
      url,
    };
    const existingIndex = byUrl.get(url);
    if (existingIndex === undefined) {
      byUrl.set(url, result.length);
      result.push(identity);
      continue;
    }

    const existing = result[existingIndex]!;
    if (existing.id === "store-character" && id !== "store-character") {
      result[existingIndex] = identity;
    }
  }

  return result;
}

export function resolveCharacterReferenceUrls(
  selectionIds: string[],
  references: DirectorVisualReference[],
  storeCharacterUrl: string | null,
): string[] {
  return resolveCharacterIdentities(selectionIds, references, storeCharacterUrl).map((identity) => identity.url);
}

export function buildCharacterIdentityInstruction(
  identities: DirectorCharacterIdentity[],
  referenceUrls: string[],
): string {
  if (!identities.length) return "";
  const bindings = identities
    .map((identity, index) => {
      const referenceIndex = referenceUrls.indexOf(identity.url);
      const displayIndex = referenceIndex >= 0 ? referenceIndex + 1 : index + 1;
      return `Reference image ${displayIndex} is Character ${index + 1}: ${identity.name}.`;
    })
    .join(" ");
  const separation = identities.length > 1
    ? `Show all ${identities.length} selected characters as distinct people with their own faces and bodies. Do not duplicate, clone, merge, swap, or blend one character into another.`
    : "Keep this character's identity matched exactly to the named reference image.";
  return `Character identity lock: ${bindings} ${separation}`;
}

export function buildApprovalReferenceImages(
  currentImageUrl: string | undefined,
  selectedCharacterUrls: string[],
): Array<{ uri: string }> {
  return uniqueUrls([currentImageUrl, ...selectedCharacterUrls]).map((uri) => ({ uri }));
}

export function chooseApprovedShotSeed(
  approval?: { url: string; approved: boolean },
): string | undefined {
  const url = approval?.approved ? approval.url.trim() : "";
  return url || undefined;
}
