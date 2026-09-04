"""Adapted from video-db/Director@70e0b3df under the MIT license."""

import json

from pydantic import Field, FieldValidationInfo, field_validator
from pydantic_settings import SettingsConfigDict

from .base import BaseLLM, BaseLLMConfig, LLMResponse, LLMResponseStatus


class GoogleAIConfig(BaseLLMConfig):
    model_config = SettingsConfigDict(env_prefix="GOOGLEAI_", extra="ignore")

    llm_type: str = "googleai"
    api_key: str = ""
    api_base: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    chat_model: str = Field(default="gemini-3.6-flash")
    temperature: float = 0.0
    max_tokens: int = 8192

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: str, info: FieldValidationInfo):
        if not value:
            raise ValueError(f"{info.field_name} must not be empty; set GOOGLEAI_API_KEY")
        return value


class GoogleAI(BaseLLM):
    def __init__(self, config: GoogleAIConfig | None = None):
        super().__init__(config or GoogleAIConfig())
        import openai

        self.client = openai.OpenAI(api_key=self.api_key, base_url=self.api_base)

    @staticmethod
    def _format_messages(messages: list[dict]) -> list[dict]:
        formatted: list[dict] = []
        for message in messages:
            if message.get("role") == "assistant" and message.get("tool_calls"):
                formatted.append({
                    "role": "assistant",
                    "content": message.get("content") or "",
                    "tool_calls": [
                        {
                            "id": call["id"],
                            "function": {
                                "name": call["tool"]["name"],
                                "arguments": json.dumps(call["tool"]["arguments"]),
                            },
                            "type": call.get("type", "function"),
                        }
                        for call in message["tool_calls"]
                    ],
                })
            else:
                formatted.append(message)
        return formatted

    @staticmethod
    def _format_tools(tools: list[dict]) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", {}),
                },
            }
            for tool in tools
            if tool.get("name")
        ]

    def chat_completions(self, messages: list[dict], tools: list[dict] | None = None, **kwargs) -> LLMResponse:
        params = {
            "model": self.chat_model,
            "messages": self._format_messages(messages),
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "top_p": self.top_p,
            "timeout": self.timeout,
        }
        if tools:
            params["tools"] = self._format_tools(tools)
            params["tool_choice"] = "auto"
        if kwargs.get("response_format"):
            params["response_format"] = kwargs["response_format"]

        try:
            response = self.client.chat.completions.create(**params)
        except Exception as error:
            return LLMResponse(content=f"Error: {error}", status=LLMResponseStatus.ERROR)

        choice = response.choices[0]
        message = choice.message
        return LLMResponse(
            content=message.content or "",
            tool_calls=[
                {
                    "id": call.id,
                    "tool": {
                        "name": call.function.name,
                        "arguments": json.loads(call.function.arguments),
                    },
                    "type": call.type,
                }
                for call in (message.tool_calls or [])
            ],
            finish_reason=choice.finish_reason or "",
            send_tokens=getattr(response.usage, "prompt_tokens", 0) or 0,
            recv_tokens=getattr(response.usage, "completion_tokens", 0) or 0,
            total_tokens=getattr(response.usage, "total_tokens", 0) or 0,
            status=LLMResponseStatus.SUCCESS,
        )
