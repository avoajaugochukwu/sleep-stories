"""Model config for scene_director."""

from __future__ import annotations

REASONING = "low"  # paid on every chunk of every video — see agents/CLAUDE.md

# Failures here are per scene and bank independently, so a retry costs only the
# scenes that failed. Three rounds is enough for that to converge.
MAX_ATTEMPTS = 3
