import logging
import time

import httpx
from google import genai
from google.genai import types
from google.genai.errors import ClientError, ServerError

from app import config
from app.llm.interface import (
    LLMEmptyResponse,
    LLMError,
    LLMNotConfigured,
    LLMProvider,
    LLMQuotaExceeded,
    LLMUnavailable,
)

logger = logging.getLogger(__name__)

ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2


class GeminiProvider(LLMProvider):
    def __init__(self, client=None):
        if client is None:
            try:
                client = genai.Client()
            except Exception as e:
                logger.error("Gemini client could not be created: %s", type(e).__name__)
                raise LLMNotConfigured() from None
        self.client = client
        self.model = config.GEMINI_MODEL

    def generate_response(self, system_prompt: str, user_prompt: str) -> str:
        for attempt in range(ATTEMPTS):
            try:
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=0.0,
                    )
                )
            except ClientError as e:
                logger.warning("Gemini client error %s", e.code)
                if e.code == 429:
                    raise LLMQuotaExceeded() from None
                if e.code in (401, 403):
                    raise LLMNotConfigured() from None
                raise LLMError() from None
            except (ServerError, httpx.TransportError) as e:
                logger.warning("Gemini unavailable (attempt %d/%d): %s", attempt + 1, ATTEMPTS, type(e).__name__)
                if attempt == ATTEMPTS - 1:
                    raise LLMUnavailable() from None
                time.sleep(RETRY_DELAY_SECONDS)
                continue
            text = response.text
            if not text or not text.strip():
                raise LLMEmptyResponse()
            return text
        raise LLMUnavailable()
