"""Model config for script_context.

Effort is declared here rather than read from shared/config.py so one agent can
never change another's cost by editing a shared default.
"""

from __future__ import annotations

REASONING = "low"  # one call per job, but see agents/CLAUDE.md — low unless measured

MAX_ATTEMPTS = 3   # validate -> repair rounds before raising
