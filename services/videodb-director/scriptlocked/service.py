from director.core.session import Session

from .agent import ScriptLockedAgnesAgent
from .continuity import build_continuity_constraints
from .llm import get_scriptlocked_llm
from .models import AgnesExecutionShot, CompileRequest, CompileResponse


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
