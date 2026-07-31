"""Model access config, shared by every agent.

Ported from ../../../video-agents/military/agents/shared/config.py, minus the
codex-subscription switch: that pays for itself there because `identify` makes
~174 vision calls per job. Here the whole pipeline is ~5 model calls against 176
image generations, so image spend dominates and the switch would be complexity
for no saving. See PLAN-AGENTS.md.

Model matches the app's own `lib/ai/openai.ts` DEFAULT_MODEL — a scene written by
an agent and a scene written by the legacy TS path should not differ because they
asked different models. Env-overridable so a deploy can move both together.

Per-agent overrides (effort, attempts) live in that agent's own config.py so one
agent can never change another's cost by editing this file.
"""

from __future__ import annotations

import os as _os

MODEL = _os.environ.get("AGENT_MODEL", "gpt-5-mini")
REASONING = "low"  # reasoning_effort

REQUEST_TIMEOUT_S = 180.0
MAX_TOKENS = 16000

# SDK-level retries for 429 / 5xx only (it honours Retry-After). Chunks run
# concurrently, so rate-limit bursts are the normal case and must not surface as
# a refusal. Transport retries and content retries (the repair loop) are
# different problems; this is the former.
MAX_TRANSPORT_RETRIES = 2
