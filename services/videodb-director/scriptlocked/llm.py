import os

from director.llm.base import BaseLLM, BaseLLMConfig, LLMResponse, LLMResponseStatus
from director.llm.googleai import GoogleAI


class ReasonerUnavailable(RuntimeError):
    pass


class StaticTestLLM(BaseLLM):
    def __init__(self, response_text: str):
        super().__init__(BaseLLMConfig(llm_type="test", chat_model="static-test"))
        self.response_text = response_text

    def chat_completions(self, messages: list[dict], tools: list[dict] | None = None, **kwargs) -> LLMResponse:
        return LLMResponse(content=self.response_text, status=LLMResponseStatus.SUCCESS)


def get_scriptlocked_llm() -> BaseLLM:
    if "SCRIPTLOCKED_TEST_RESPONSE" in os.environ:
        return StaticTestLLM(os.environ["SCRIPTLOCKED_TEST_RESPONSE"])
    if not os.getenv("GOOGLEAI_API_KEY"):
        raise ReasonerUnavailable("GOOGLEAI_API_KEY is not configured")
    try:
        return GoogleAI()
    except Exception as error:
        raise ReasonerUnavailable(str(error)) from error
