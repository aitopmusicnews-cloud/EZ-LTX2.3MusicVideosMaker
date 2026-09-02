export type DirectorCharacterState = {
  approvedCharacterIds: string[];
  characterSelections: Record<string, string[]>;
};

type CharacterMigrationInput = {
  approvedCharacterIds?: unknown;
  characterSelections?: unknown;
  legacyCharacterApproved?: boolean;
  legacyCharacterReferenceId?: string | null;
  validCharacterIds: string[];
};

function uniqueValid(values: unknown, validIds: Set<string>): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !validIds.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function toggleApprovedCharacter(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((value) => value !== id);
  return [...ids, id];
}

export function sanitizeCharacterSelections(
  selections: Record<string, string[]>,
  approvedIds: string[],
): Record<string, string[]> {
  const approved = new Set(approvedIds);
  return Object.fromEntries(
    Object.entries(selections).map(([clipId, ids]) => [clipId, uniqueValid(ids, approved)]),
  );
}

export function setClipCharacterSelection(
  current: Record<string, string[]>,
  clipId: string,
  requestedIds: string[],
  approvedIds: string[],
): Record<string, string[]> {
  return {
    ...current,
    [clipId]: uniqueValid(requestedIds, new Set(approvedIds)),
  };
}

export function selectionForClip(
  selections: Record<string, string[]>,
  clipId: string,
  legacyConditioningReferenceId?: string | null,
): string[] {
  const selected = selections[clipId];
  if (Array.isArray(selected)) return [...selected];
  return legacyConditioningReferenceId ? [legacyConditioningReferenceId] : [];
}

export function migrateDirectorCharacterState(input: CharacterMigrationInput): DirectorCharacterState {
  const validIds = new Set(input.validCharacterIds);
  let approvedCharacterIds = uniqueValid(input.approvedCharacterIds, validIds);

  if (
    approvedCharacterIds.length === 0 &&
    input.legacyCharacterApproved &&
    input.legacyCharacterReferenceId &&
    validIds.has(input.legacyCharacterReferenceId)
  ) {
    approvedCharacterIds = [input.legacyCharacterReferenceId];
  }

  const rawSelections = input.characterSelections && typeof input.characterSelections === "object"
    ? input.characterSelections as Record<string, unknown>
    : {};
  const approved = new Set(approvedCharacterIds);
  const characterSelections = Object.fromEntries(
    Object.entries(rawSelections).map(([clipId, ids]) => [clipId, uniqueValid(ids, approved)]),
  );

  return { approvedCharacterIds, characterSelections };
}
