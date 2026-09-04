from .fidelity import sanitize_reference_description
from .models import ScriptLockedReference, ScriptLockedShot


def build_continuity_constraints(
    shot: ScriptLockedShot,
    references: list[ScriptLockedReference],
) -> list[str]:
    by_id = {reference.id: reference for reference in references}
    constraints: list[str] = []

    for character_id in shot.selectedCharacterIds:
        reference = by_id.get(character_id)
        if reference is None:
            continue
        constraints.append(
            f"Match {reference.name} / {reference.id} exactly: same identity, skin tone/complexion, face, hair, wardrobe, jewelry, and accessories unless this shot explicitly changes them."
        )

    character_ids = set(shot.selectedCharacterIds)
    for reference_id in shot.selectedReferenceIds:
        if reference_id in character_ids:
            continue
        reference = by_id.get(reference_id)
        if reference is None or reference.kind not in {"shot", "note", "location", "style"}:
            continue
        description = sanitize_reference_description(shot, reference, references)
        if description:
            constraints.append(
                f"Preserve the approved continuity facts from {reference.name} / {reference.id}: {description}."
            )

    return constraints
