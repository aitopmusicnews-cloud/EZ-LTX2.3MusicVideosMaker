import json

from director.agents.base import AgentResponse, AgentStatus, BaseAgent
from director.core.session import ContextMessage, RoleTypes
from director.llm.base import BaseLLM

from .fidelity import allowed_facts_text, validate_no_generic_additions, validate_selected_references
from .llm import ReasonerUnavailable
from .models import ScriptLockedReference, ScriptLockedShot


SCRIPT_LOCKED_SYSTEM = """
You are ScriptLockedAgnesAgent, an execution-prompt compiler for Agnes video generation.
The current timecoded shot is the source of truth.
Reorder and clarify the same visible facts into chronological Agnes-friendly language only.
Never add a person, location, prop, wardrobe/equipment item, vehicle, instrument, lighting concept, palette, weather, time of day, camera move, story beat, dialogue, on-screen text, or transition not present in the current shot or supplied approved continuity facts.
Never add generic cinematic filler unless the user wrote it.
Return only the compiled Agnes prompt text.
""".strip()


class ScriptLockedAgnesAgent(BaseAgent):
    agent_name = "script_locked_agnes"
    description = "Compile one immutable timecoded shot into a precise Agnes execution prompt without creative reinterpretation."
    parameters = {
        "type": "object",
        "properties": {
            "shot": {"type": "object"},
            "references": {"type": "array", "items": {"type": "object"}},
            "mustInclude": {"type": "string"},
            "avoid": {"type": "string"},
            "continuityConstraints": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["shot", "references"],
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
        selected_references = [
            reference.model_dump()
            for reference in references
            if reference.id in selected_ids
        ]
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
        return prompt

    def run(
        self,
        shot: dict,
        references: list[dict],
        mustInclude: str = "",
        avoid: str = "",
        continuityConstraints: list[str] | None = None,
        **kwargs,
    ) -> AgentResponse:
        try:
            compiled = self.compile_prompt(
                ScriptLockedShot.model_validate(shot),
                [ScriptLockedReference.model_validate(reference) for reference in references],
                mustInclude,
                avoid,
                continuityConstraints or [],
            )
            return AgentResponse(status=AgentStatus.SUCCESS, data={"agnesPrompt": compiled})
        except Exception as error:
            return AgentResponse(status=AgentStatus.ERROR, message=str(error))
