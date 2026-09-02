export type DirectorVisualReference = {
  id: string;
  url?: string;
  anchorUrl?: string;
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

export function resolveCharacterReferenceUrls(
  selectionIds: string[],
  references: DirectorVisualReference[],
  storeCharacterUrl: string | null,
): string[] {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  return uniqueUrls(selectionIds.map((id) => {
    if (id === "store-character") return storeCharacterUrl;
    const reference = byId.get(id);
    return reference?.anchorUrl ?? reference?.url;
  }));
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
