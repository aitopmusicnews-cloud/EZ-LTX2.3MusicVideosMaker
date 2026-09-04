"""Adapted from video-db/Director@70e0b3df under the MIT license."""

from abc import ABC, abstractmethod
from typing import Dict, List

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class LLMResponseStatus:
    SUCCESS: bool = True
    ERROR: bool = False


class LLMResponse(BaseModel):
    content: str = ""
    tool_calls: List[Dict] = Field(default_factory=list)
    send_tokens: int = 0
    recv_tokens: int = 0
    total_tokens: int = 0
    finish_reason: str = ""
    status: bool = LLMResponseStatus.ERROR


class BaseLLMConfig(BaseSettings):
    llm_type: str = ""
    api_key: str = ""
    api_base: str = ""
    chat_model: str = ""
    temperature: float = 0.0
    top_p: float = 1.0
    max_tokens: int = 4096
    timeout: int = 120


class BaseLLM(ABC):
    def __init__(self, config: BaseLLMConfig):
        self.config = config
        self.llm_type = config.llm_type
        self.api_key = config.api_key
        self.api_base = config.api_base
        self.chat_model = config.chat_model
        self.temperature = config.temperature
        self.top_p = config.top_p
        self.max_tokens = config.max_tokens
        self.timeout = config.timeout

    @abstractmethod
    def chat_completions(self, messages: list[dict], tools: list[dict] | None = None, **kwargs) -> LLMResponse:
        raise NotImplementedError
