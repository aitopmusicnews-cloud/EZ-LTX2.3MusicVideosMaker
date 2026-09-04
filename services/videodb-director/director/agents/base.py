"""Adapted from video-db/Director@70e0b3df under the MIT license."""

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field


class AgentStatus:
    SUCCESS = "success"
    ERROR = "error"


class AgentResponse(BaseModel):
    status: str = AgentStatus.SUCCESS
    message: str = ""
    data: dict = Field(default_factory=dict)


class BaseAgent(ABC):
    def __init__(self, session, **kwargs):
        self.session = session

    @property
    def name(self):
        return self.agent_name

    @property
    def agent_description(self):
        return self.description

    def to_llm_format(self) -> dict:
        return {
            "name": self.agent_name,
            "description": self.description,
            "parameters": self.parameters,
        }

    def safe_call(self, *args, **kwargs) -> AgentResponse:
        try:
            return self.run(*args, **kwargs)
        except Exception as error:
            return AgentResponse(status=AgentStatus.ERROR, message=str(error))

    @abstractmethod
    def run(self, *args, **kwargs) -> AgentResponse:
        raise NotImplementedError
