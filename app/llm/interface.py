from abc import ABC, abstractmethod


class LLMError(Exception):
    """A failed LLM call. The message is safe to show to API clients (no provider text, no credentials)."""
    message = "The language model request failed."

    def __init__(self, message: str = None):
        self.message = message or self.message
        super().__init__(self.message)


class LLMQuotaExceeded(LLMError):
    message = "The language model's quota or rate limit is exhausted; try again later."


class LLMUnavailable(LLMError):
    message = "The language model is temporarily unavailable; try again in a moment."


class LLMEmptyResponse(LLMError):
    message = "The language model returned an empty answer; try rephrasing the question."


class LLMNotConfigured(LLMError):
    message = "The language model is not configured (missing or invalid API key)."


class LLMProvider(ABC):
    @abstractmethod
    def generate_response(self, system_prompt: str, user_prompt: str) -> str:
        """Takes a system instruction and user prompt, returns the LLM's text response.

        Raises an LLMError subclass on failure, including an empty response.
        """
        pass
