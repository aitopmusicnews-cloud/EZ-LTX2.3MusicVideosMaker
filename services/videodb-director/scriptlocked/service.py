import re

from director.agents.base import AgentStatus
from director.core.reasoning import ReasoningEngine
from director.core.session import Session

from .agent import ScriptLockedAgnesAgent
from .continuity import build_continuity_constraints
from .llm import ReasonerUnavailable, get_scriptlocked_llm
from .models import AgnesExecutionShot, CompileRequest, CompileResponse, EditRequest, EditResponse


class LockedSourceConflict(ValueError):
    pass


TIME_RANGE = re.compile(r"\b\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}\b")
CHANGE_LOCKED_FACT = re.compile(r"\b(?:change|replace)\s+(?:the\s+)?(.+?)\s+(?:to|with)\s+(.+)", re.IGNORECASE)
ADDITION_VERBS = re.compile(r"\b(?:add|include|put)\b", re.IGNORECASE)
ADDITION_NOUNS = ("person", "character", "dancer", "location", "club", "nightclub", "prop", "car", "vehicle", "piano", "microphone")


def _edit_conflict_reason(request: EditRequest) -> str | None:
    message = request.userMessage.strip()
    if TIME_RANGE.search(message):
        return "timecodes are locked; edit the source script to change timing"

    replacement = CHANGE_LOCKED_FACT.search(message)
    if replacement:
        old_fact = replacement.group(1).strip(" .,:;\"'").lower()
        if old_fact and old_fact in request.sourceText.lower():
            return f"'{old_fact}' is a locked source fact; edit the source script to replace it"

    if ADDITION_VERBS.search(message):
        allowed = "\n".join([request.sourceText, request.currentAgnesPrompt, *request.continuityConstraints]).lower()
        added = [noun for noun in ADDITION_NOUNS if noun in message.lower() and noun not in allowed]
        if added:
            return f"new source fact requires a source-script edit: {', '.join(added)}"

    return None


def compile_project(request: CompileRequest) -> CompileResponse:
    llm = get_scriptlocked_llm()
    compiled_shots: list[AgnesExecutionShot] = []

    for shot in request.shots:
        continuity_constraints = build_continuity_constraints(shot, request.references)
        agent = ScriptLockedAgnesAgent(
            session=Session(session_id=f"{request.projectId}:{shot.clipId}"),
            llm=llm,
        )
        prompt = agent.compile_prompt(
            shot,
            request.references,
            request.mustInclude,
            request.avoid,
            continuity_constraints,
        )
        compiled_shots.append(
            AgnesExecutionShot(
                clipId=shot.clipId,
                start=shot.start,
                end=shot.end,
                sourceText=shot.sourceText,
                agnesPrompt=prompt,
                selectedCharacterIds=list(shot.selectedCharacterIds),
                selectedReferenceIds=list(shot.selectedReferenceIds),
                continuityConstraints=continuity_constraints,
                compilerNotes=[],
            )
        )

    return CompileResponse(shots=compiled_shots)


def edit_instruction(request: EditRequest) -> EditResponse:
    conflict = _edit_conflict_reason(request)
    if conflict:
        raise LockedSourceConflict(conflict)

    llm = get_scriptlocked_llm()
    session = Session(session_id=f"{request.projectId}:{request.clipId}:edit")
    agent = ScriptLockedAgnesAgent(session=session, llm=llm)
    reasoning = ReasoningEngine(session=session, llm=llm)
    reasoning.register_agents([agent])
    result = reasoning.run_targeted(
        "script_locked_agnes",
        request.userMessage,
        editRequest=request.model_dump(),
    )
    if result.status != AgentStatus.SUCCESS:
        message = result.message or "instruction edit failed"
        if "unavailable" in message.lower() or "api_key" in message.lower():
            raise ReasonerUnavailable(message)
        raise ValueError(message)

    prompt = str(result.data.get("agnesPrompt", "")).strip()
    if not prompt:
        raise ValueError("edited Agnes prompt is empty")

    return EditResponse(
        clipId=request.clipId,
        start=request.start,
        end=request.end,
        sourceText=request.sourceText,
        agnesPrompt=prompt,
        compilerNotes=[],
    )
