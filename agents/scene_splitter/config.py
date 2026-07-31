"""Model config for scene_splitter."""

from __future__ import annotations

REASONING = "low"  # see agents/CLAUDE.md — low unless measured otherwise

# One more attempt than the others. This agent's failure mode is a near-miss on
# verbatim text, which is exactly the kind of thing a Fix Required block naming
# the offending snippet fixes on the next round.
MAX_ATTEMPTS = 4
