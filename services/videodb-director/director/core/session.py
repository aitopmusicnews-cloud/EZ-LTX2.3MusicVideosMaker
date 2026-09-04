"""Adapted from video-db/Director@70e0b3df under the MIT license."""

from enum import Enum

from pydantic import BaseModel, Field


class RoleTypes(str, Enum):
    system = "system"
    user = "user"
    assistant = "assistant"
    tool = "tool"


class ContextMessage(BaseModel):
    content: str | list[dict] | None = None
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    role: RoleTypes = RoleTypes.system

    def to_llm_msg(self) -> dict:
        message = {"role": self.role.value, "content": self.content}
        if self.role == RoleTypes.assistant and self.tool_calls:
            message["tool_calls"] = self.tool_calls
        if self.role == RoleTypes.tool and self.tool_call_id:
            message["tool_call_id"] = self.tool_call_id
        return message


class Session(BaseModel):
    session_id: str
    reasoning_context: list[ContextMessage] = Field(default_factory=list)
