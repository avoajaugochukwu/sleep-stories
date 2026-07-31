"""Constants checks.py enforces."""

from __future__ import annotations

# The summary is prepended to EVERY chunk prompt downstream, so its length is a
# per-chunk cost multiplied by chunk count. A 2h script is ~50 chunks; 40 wasted
# words here is 2,000 wasted words across the job.
SUMMARY_MIN_WORDS = 20
SUMMARY_MAX_WORDS = 140

# Same argument. Grounding carries the constraints (era/technology, or scale and
# light sources) — richer than the summary, still bounded.
GROUNDING_MAX_WORDS = 220

# Named things that must look the same in every scene. Capped because an
# unbounded list balloons the per-chunk prompt, and because a model that lists 40
# "recurring" subjects has not identified any.
MAX_RECURRING_SUBJECTS = 12

# Only used to cap what we SEND. The model never sees more than this many
# characters of script — the opening arc is enough to establish topic and
# setting, and the whole point of this agent is that it is cheap and runs once.
MAX_SCRIPT_CHARS = 12000
