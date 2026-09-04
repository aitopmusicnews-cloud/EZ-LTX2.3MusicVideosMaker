import re

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


def _source_facts_text(shot: ScriptLockedShot) -> str:
    return "\n".join(
        part
        for part in [
            shot.sourceText,
            shot.visualDirection,
            shot.cameraDirection,
            shot.audioCue,
            shot.onScreenText,
        ]
        if part
    )


def _mentions(text: str, alias: str) -> bool:
    value = alias.strip().lower()
    if not value:
        return False
    return re.search(rf"(?<![\w-]){re.escape(value)}(?![\w-])", text.lower()) is not None


def _unselected_character_aliases(
    shot: ScriptLockedShot,
    references: list[ScriptLockedReference],
) -> list[tuple[str, list[str]]]:
    selected = set(shot.selectedCharacterIds)
    source_text = _source_facts_text(shot)
    result: list[tuple[str, list[str]]] = []
    for reference in references:
        if reference.kind != "character" or reference.id in selected:
            continue
        aliases = [reference.name, reference.id]
        if any(_mentions(source_text, alias) for alias in aliases):
            # Exact source remains authoritative even when character selection is incomplete.
            continue
        result.append((reference.name or reference.id, aliases))
    return result


def sanitize_reference_description(
    shot: ScriptLockedShot,
    reference: ScriptLockedReference,
    references: list[ScriptLockedReference],
) -> str:
    description = reference.description.strip()
    if not description or reference.kind == "character":
        return description

    blocked_aliases = [
        alias
        for _, aliases in _unselected_character_aliases(shot, references)
        for alias in aliases
    ]
    if not blocked_aliases:
        return description

    sentences = re.split(r"(?<=[.!?])\s+", description)
    safe_sentences = [
        sentence.strip()
        for sentence in sentences
        if sentence.strip() and not any(_mentions(sentence, alias) for alias in blocked_aliases)
    ]
    return " ".join(safe_sentences).strip()


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
        sanitize_reference_description(shot, by_id[reference_id], references)
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


def validate_no_unselected_characters(
    prompt: str,
    shot: ScriptLockedShot,
    references: list[ScriptLockedReference],
) -> None:
    imported = [
        name
        for name, aliases in _unselected_character_aliases(shot, references)
        if any(_mentions(prompt, alias) for alias in aliases)
    ]
    if imported:
        raise ValueError(f"unselected character addition: {', '.join(imported)}")


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
