import json

from director.agents.base import AgentResponse, AgentStatus, BaseAgent
from director.core.session import ContextMessage, RoleTypes
from director.llm.base import BaseLLM

from .fidelity import (
    allowed_facts_text,
    sanitize_reference_description,
    validate_no_generic_additions,
    validate_no_unselected_characters,
    validate_selected_references,
)
from .llm import ReasonerUnavailable
from .models import EditRequest, ScriptLockedReference, ScriptLockedShot


SCRIPT_LOCKED_SYSTEM = """
You are ScriptLockedAgnesAgent, an execution-prompt compiler for Agnes video generation.
The current timecoded shot is the source of truth.
Reorder and clarify the same visible facts into chronological Agnes-friendly language only.
Never add a person, location, prop, wardrobe/equipment item, vehicle, instrument, lighting concept, palette, weather, time of day, camera move, story beat, dialogue, on-screen text, or transition not present in the current shot or supplied approved continuity facts.
Never add generic cinematic filler unless the user wrote it.
Return only the compiled Agnes prompt text.
""".strip()

EDIT_SYSTEM = """
You edit exactly one existing Agnes instruction for one immutable timecoded shot.
Keep clip timing and source facts unchanged.
Apply only the user's requested instruction change when it does not contradict the locked source.
Do not add unrelated creative content and do not operate on any other shot.
Return only the revised Agnes prompt text.
""".strip()


class ScriptLockedAgnesAgent(BaseAgent):
    agent_name = "script_locked_agnes"
    description = "Compile or edit one immutable timecoded shot into a precise Agnes instruction without creative reinterpretation."
    parameters = {
        "type": "object",
        "properties": {
            "editRequest": {"type": "object"},
            "shot": {"type": "object"},
            "references": {"type": "array", "items": {"type": "object"}},
            "mustInclude": {"type": "string"},
            "avoid": {"type": "string"},
            "continuityConstraints": {"type": "array", "items": {"type": "string"}},
        },
    }

    def __init__(self, session, llm: BaseLLM):
        super().__init__(session=session)
        self.llm = llm

    def compile_prompt(
        self,
        shot: ScriptLockedShot,
        references: list[ScriptLockedReference],
        must_include: str = "",
        avoid: str = "",
        continuity_constraints: list[str] | None = None,
    ) -> str:
        continuity_constraints = continuity_constraints or []
        validate_selected_references(shot, references)

        selected_ids = set(shot.selectedReferenceIds) | set(shot.selectedCharacterIds)
        selected_references = []
        for reference in references:
            if reference.id not in selected_ids:
                continue
            payload = reference.model_dump()
            if reference.kind != "character":
                payload["description"] = sanitize_reference_description(shot, reference, references)
            selected_references.append(payload)

        user_payload = {
            "task": "Compile only this shot into an Agnes execution prompt.",
            "shot": shot.model_dump(),
            "approvedSelectedReferences": selected_references,
            "continuityConstraints": continuity_constraints,
            "mustInclude": must_include,
            "avoid": avoid,
        }
        messages = [
            ContextMessage(content=SCRIPT_LOCKED_SYSTEM, role=RoleTypes.system).to_llm_msg(),
            ContextMessage(content=json.dumps(user_payload, ensure_ascii=False), role=RoleTypes.user).to_llm_msg(),
        ]
        response = self.llm.chat_completions(messages=messages, tools=[])
        if not response.status:
            raise ReasonerUnavailable(response.content or "reasoning unavailable")

        prompt = response.content.strip()
        allowed_text = allowed_facts_text(
            shot,
            references,
            must_include,
            avoid,
            continuity_constraints,
        )
        validate_no_generic_additions(prompt, allowed_text)
        validate_no_unselected_characters(prompt, shot, references)
        return prompt

    def edit_prompt(self, edit_request: EditRequest) -> str:
        payload = {
            "task": "Edit only this Agnes instruction.",
            "clipId": edit_request.clipId,
            "start": edit_request.start,
            "end": edit_request.end,
            "sourceText": edit_request.sourceText,
            "currentAgnesPrompt": edit_request.currentAgnesPrompt,
            "selectedCharacterIds": edit_request.selectedCharacterIds,
            "selectedReferenceIds": edit_request.selectedReferenceIds,
            "continuityConstraints": edit_request.continuityConstraints,
            "userMessage": edit_request.userMessage,
        }
        response = self.llm.chat_completions(
            messages=[
                ContextMessage(content=EDIT_SYSTEM, role=RoleTypes.system).to_llm_msg(),
                ContextMessage(content=json.dumps(payload, ensure_ascii=False), role=RoleTypes.user).to_llm_msg(),
            ],
            tools=[],
        )
        if not response.status:
            raise ReasonerUnavailable(response.content or "reasoning unavailable")
        prompt = response.content.strip()
        allowed = "\n".join([
            edit_request.sourceText,
            edit_request.currentAgnesPrompt,
            edit_request.userMessage,
            *edit_request.continuityConstraints,
        ])
        validate_no_generic_additions(prompt, allowed)
        return prompt

    def run(
        self,
        editRequest: dict | None = None,
        shot: dict | None = None,
        references: list[dict] | None = None,
        mustInclude: str = "",
        avoid: str = "",
        continuityConstraints: list[str] | None = None,
        **kwargs,
    ) -> AgentResponse:
        try:
            if editRequest is not None:
                edited = self.edit_prompt(EditRequest.model_validate(editRequest))
                return AgentResponse(status=AgentStatus.SUCCESS, data={"agnesPrompt": edited})
            if shot is None:
                raise ValueError("shot is required")
            compiled = self.compile_prompt(
                ScriptLockedShot.model_validate(shot),
                [ScriptLockedReference.model_validate(reference) for reference in (references or [])],
                mustInclude,
                avoid,
                continuityConstraints or [],
            )
            return AgentResponse(status=AgentStatus.SUCCESS, data={"agnesPrompt": compiled})
        except Exception as error:
            return AgentResponse(status=AgentStatus.ERROR, message=str(error))
