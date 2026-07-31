"""Model-access layer.

Ported from military's shared/llm.py with two things removed on purpose:

  - the codex-subscription backend — no call volume here justifies it
    (PLAN-AGENTS.md, "Cost")
  - `call_with_tools` — no agent in this app has a tool. Military's own rule is
    "tools are the exception, not the pattern"; an unused tool loop is a hundred
    lines nobody tests.

Every answer is constrained by a strict json_schema (Structured Outputs): the
decoder cannot emit tokens that violate the schema, so malformed JSON, extra
objects and prose preambles are impossible. No post-hoc salvage, no repair round
for shape — the repair loop in each client.py exists for SEMANTIC failures only.

There is no fallback provider. A genuine refusal raises and fails the job: a
loud stop beats a silently degraded video, per agents/CLAUDE.md.

The `openai` SDK is imported lazily inside the client builder, so importing this
module works without the SDK installed — see the offline-test rule.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from . import config

if TYPE_CHECKING:
    from openai import OpenAI


class Refused(Exception):
    """Content filter / empty / truncated / API error. Terminal — no fallback."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


_openai_client: "OpenAI | None" = None


def _openai() -> "OpenAI":
    global _openai_client
    if _openai_client is None:
        import os

        from openai import OpenAI

        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not set in the environment")
        _openai_client = OpenAI(
            api_key=key,
            timeout=config.REQUEST_TIMEOUT_S,
            max_retries=config.MAX_TRANSPORT_RETRIES,
        )
    return _openai_client


def _reasoning() -> dict:
    return {"reasoning_effort": config.REASONING} if config.REASONING else {}


def call_structured(messages: list[dict], schema: type) -> dict:
    """One structured chat/completions answer, constrained to `schema`.

    `schema` is a Pydantic model class; the return is `.model_dump()` of the
    parsed instance. Raises Refused on anything that is not a clean answer.
    """
    try:
        resp = _openai().chat.completions.parse(
            model=config.MODEL,
            messages=messages,
            response_format=schema,
            max_completion_tokens=config.MAX_TOKENS,
            **_reasoning(),
        )
    except Exception as e:  # noqa: BLE001 — any SDK/transport error is a refusal to us
        raise Refused(f"api_error: {type(e).__name__}: {e}")

    choice = resp.choices[0]
    if choice.finish_reason == "content_filter":
        raise Refused("content_filter")
    msg = choice.message
    if getattr(msg, "refusal", None):
        raise Refused(f"refusal:{msg.refusal[:200]}")
    if msg.parsed is None:
        raise Refused(f"empty:{choice.finish_reason}")
    return msg.parsed.model_dump(mode="json")
