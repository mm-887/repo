import threading

from app.llm.gemini_provider import GeminiProvider

_provider = None
_lock = threading.Lock()


def get_llm_provider():
    """One provider (and so one Gemini client) per process."""
    global _provider
    with _lock:
        if _provider is None:
            _provider = GeminiProvider()
        return _provider


def _reset():
    global _provider
    with _lock:
        _provider = None
