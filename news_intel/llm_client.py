"""
Shared LLM client configuration for Python modules.

Gemini is the default provider. The module can still run against OpenAI-compatible
providers (Groq/OpenRouter/OpenAI) through environment overrides.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, Optional, TypeVar

from openai import OpenAI

logger = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_PROVIDER = "gemini"
DEFAULT_GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
RETRYABLE_ERROR_SNIPPETS = (
    "timed out",
    "timeout",
    "socket hang up",
    "econnreset",
    "ehostunreach",
    "etimedout",
    "connection",
    "network",
)


def _clean_env(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _first_env(*keys: str) -> Optional[str]:
    for key in keys:
        value = _clean_env(os.environ.get(key))
        if value:
            return value
    return None


def get_llm_provider() -> str:
    provider = (_clean_env(os.environ.get("LLM_PROVIDER")) or DEFAULT_PROVIDER).lower()
    if provider in {"openai", "groq", "openrouter", "gemini"}:
        return provider
    return "gemini"


def _default_openai_base_url(provider: str) -> str:
    if provider == "gemini":
        return DEFAULT_GEMINI_OPENAI_BASE_URL
    if provider == "groq":
        return DEFAULT_GROQ_BASE_URL
    if provider == "openrouter":
        return DEFAULT_OPENROUTER_BASE_URL
    return DEFAULT_OPENAI_BASE_URL


def get_llm_api_key(provider: Optional[str] = None) -> Optional[str]:
    provider = provider or get_llm_provider()
    if provider == "gemini":
        return _first_env("GEMINI_API_KEY", "OPENAI_API_KEY")
    if provider == "groq":
        return _first_env("GROQ_API_KEY", "OPENAI_API_KEY")
    if provider == "openrouter":
        return _first_env("OPENROUTER_API_KEY", "OPENAI_API_KEY")
    return _first_env("OPENAI_API_KEY")


def get_openai_base_url(provider: Optional[str] = None) -> str:
    provider = provider or get_llm_provider()
    return _clean_env(os.environ.get("OPENAI_BASE_URL")) or _default_openai_base_url(provider)


def has_llm_credentials() -> bool:
    api_key = get_llm_api_key()
    return bool(api_key and not is_placeholder_key(api_key))


def is_placeholder_key(api_key: Optional[str]) -> bool:
    if not api_key:
        return True
    low = api_key.lower()
    return low.startswith("sk-your") or "replace-me" in low or "your-key" in low


def get_model_for_workload(workload: str) -> str:
    chat_model = _first_env("CHAT_MODEL", "LLM_CHAT_MODEL", "GEMINI_CHAT_MODEL") or "gemini-2.5-flash"
    chat_web_model = (
        _first_env("CHAT_WEB_MODEL", "LLM_CHAT_WEB_MODEL", "GEMINI_CHAT_WEB_MODEL")
        or chat_model
    )
    pipeline_model = (
        _first_env("PIPELINE_MODEL", "LLM_PIPELINE_MODEL", "GEMINI_PIPELINE_MODEL")
        or "gemini-2.5-flash-lite"
    )
    digest_model = (
        _first_env("DIGEST_MODEL", "LLM_DIGEST_MODEL", "GEMINI_DIGEST_MODEL")
        or "gemini-2.5-flash"
    )
    python_intel_model = (
        _first_env("PYTHON_INTELLIGENCE_MODEL", "INTELLIGENCE_MODEL", "LLM_PYTHON_INTEL_MODEL")
        or "gemini-2.5-flash"
    )

    if workload == "chat":
        return chat_model
    if workload == "chat_web":
        return chat_web_model
    if workload == "pipeline":
        return pipeline_model
    if workload == "digest":
        return digest_model
    if workload == "python_intel":
        return python_intel_model
    return chat_model


def create_openai_client() -> Optional[OpenAI]:
    provider = get_llm_provider()
    api_key = get_llm_api_key(provider)
    if is_placeholder_key(api_key):
        logger.info("No valid LLM API key configured")
        return None

    kwargs: dict[str, Any] = {"api_key": api_key}
    base_url = get_openai_base_url(provider)
    if base_url:
        kwargs["base_url"] = base_url

    if provider == "openrouter":
        kwargs["default_headers"] = {
            "HTTP-Referer": os.environ.get("OPENROUTER_SITE_URL", "https://localhost"),
            "X-Title": os.environ.get("OPENROUTER_APP_NAME", "Jeff Intelligence System"),
        }

    return OpenAI(**kwargs)


def _error_status(exc: Exception) -> Optional[int]:
    for attr in ("status", "status_code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    if response is not None:
        status = getattr(response, "status_code", None) or getattr(response, "status", None)
        if isinstance(status, int):
            return status
    return None


def _is_retryable(exc: Exception) -> bool:
    status = _error_status(exc)
    if status is not None:
        return status in RETRYABLE_STATUS_CODES
    msg = str(exc).lower()
    return any(snippet in msg for snippet in RETRYABLE_ERROR_SNIPPETS)


def call_with_retry(
    operation_name: str,
    fn: Callable[[], T],
    attempts: Optional[int] = None,
    base_delay_sec: Optional[float] = None,
    max_delay_sec: Optional[float] = None,
) -> T:
    attempts = max(1, attempts or int(os.environ.get("LLM_RETRY_ATTEMPTS", "3")))
    base_delay_sec = max(0.1, base_delay_sec or float(os.environ.get("LLM_RETRY_BASE_MS", "500")) / 1000.0)
    max_delay_sec = max(base_delay_sec, max_delay_sec or float(os.environ.get("LLM_RETRY_MAX_MS", "5000")) / 1000.0)

    last_exc: Optional[Exception] = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt >= attempts or not _is_retryable(exc):
                raise
            delay = min(max_delay_sec, base_delay_sec * (2 ** (attempt - 1)))
            logger.warning(
                "LLM call failed; retrying (%s attempt %d/%d in %.2fs): %s",
                operation_name,
                attempt,
                attempts,
                delay,
                exc,
            )
            time.sleep(delay)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError(f"{operation_name} failed without exception")
