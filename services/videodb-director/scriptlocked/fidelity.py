from .models import ScriptLockedReference, ScriptLockedShot


GENERIC_ADDITION_TERMS = (
    "nightclub",
    "neon",
    "smoke",
    "dancers",
    "stage",
    "dramatic lighting",
    "cinematic palette",
    "director style",
)


def validate_selected_references(
    shot: ScriptLockedShot,
    references: list[ScriptLockedReference],
) -> None:
    by_id = {reference.id: reference for reference in references}
    unknown = [reference_id for reference_id in shot.selectedReferenceIds if reference_id not in by_id]
    unknown += [character_id for character_id in shot.selectedCharacterIds if character_id not in by_id]
    if unknown:
        raise ValueError(f"unknown reference id: {', '.join(sorted(set(unknown)))}")

    non_character = [
        character_id
        for character_id in shot.selectedCharacterIds
        if by_id[character_id].kind != "character"
    ]
    if non_character:
        raise ValueError(f"selected character id is not a character reference: {', '.join(non_character)}")


def allowed_facts_text(
    shot: ScriptLockedShot,
    references: list[ScriptLockedReference],
    must_include: str,
    avoid: str,
    continuity_constraints: list[str],
) -> str:
    by_id = {reference.id: reference for reference in references}
    selected_descriptions = [
        by_id[reference_id].description
        for reference_id in shot.selectedReferenceIds
        if reference_id in by_id
    ]
    return "\n".join(
        part
        for part in [
            shot.sourceText,
            shot.visualDirection,
            shot.cameraDirection,
            shot.audioCue,
            shot.onScreenText,
            must_include,
            avoid,
            *selected_descriptions,
            *continuity_constraints,
        ]
        if part
    )


def validate_no_generic_additions(prompt: str, allowed_text: str) -> None:
    normalized_prompt = prompt.lower()
    normalized_allowed = allowed_text.lower()
    invented = [
        term
        for term in GENERIC_ADDITION_TERMS
        if term in normalized_prompt and term not in normalized_allowed
    ]
    if invented:
        raise ValueError(f"unsupported addition: {', '.join(invented)}")
    if not prompt.strip():
        raise ValueError("compiled Agnes prompt is empty")
