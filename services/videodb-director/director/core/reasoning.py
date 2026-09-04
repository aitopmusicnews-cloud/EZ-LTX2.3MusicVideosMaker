"""Narrow reasoning pattern adapted from video-db/Director@70e0b3df (MIT)."""

from director.agents.base import AgentResponse, AgentStatus, BaseAgent
from director.core.session import ContextMessage, RoleTypes, Session
from director.llm.base import BaseLLM


SCRIPT_LOCKED_REASONING_SYSTEM = """
You edit exactly one Script-Locked Agnes instruction.
There is exactly one allowed agent: script_locked_agnes.
Never change clipId, start, end, or sourceText.
Never operate on another clip.
If an edit contradicts locked source facts, return a conflict instead of guessing.
Never invoke media generation.
""".strip()


class ReasoningEngine:
    def __init__(self, session: Session, llm: BaseLLM, system_prompt: str = SCRIPT_LOCKED_REASONING_SYSTEM):
        self.session = session
        self.llm = llm
        self.system_prompt = system_prompt
        self.agents: list[BaseAgent] = []

    def register_agents(self, agents: list[BaseAgent]):
        self.agents.extend(agents)

    def build_context(self, user_content: str):
        if not self.session.reasoning_context:
            self.session.reasoning_context.append(
                ContextMessage(content=self.system_prompt, role=RoleTypes.system)
            )
        self.session.reasoning_context.append(
            ContextMessage(content=user_content, role=RoleTypes.user)
        )

    def run_agent(self, agent_name: str, **kwargs) -> AgentResponse:
        agent = next((candidate for candidate in self.agents if candidate.name == agent_name), None)
        if agent is None:
            return AgentResponse(status=AgentStatus.ERROR, message=f"unknown agent: {agent_name}")
        return agent.safe_call(**kwargs)

    def run_targeted(self, agent_name: str, user_content: str, **kwargs) -> AgentResponse:
        self.build_context(user_content)
        if len(self.agents) != 1 or self.agents[0].name != agent_name:
            return AgentResponse(status=AgentStatus.ERROR, message="script-locked reasoning must register exactly one target agent")
        return self.run_agent(agent_name, **kwargs)

    def run_once(self, user_content: str) -> AgentResponse:
        self.build_context(user_content)
        response = self.llm.chat_completions(
            messages=[message.to_llm_msg() for message in self.session.reasoning_context],
            tools=[agent.to_llm_format() for agent in self.agents],
        )
        if not response.status:
            return AgentResponse(status=AgentStatus.ERROR, message=response.content or "reasoning unavailable")
        if not response.tool_calls:
            return AgentResponse(status=AgentStatus.ERROR, message="reasoner returned no tool call")
        call = response.tool_calls[0]
        return self.run_agent(call["tool"]["name"], **call["tool"]["arguments"])
