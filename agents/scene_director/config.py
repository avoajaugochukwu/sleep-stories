"""Model config for scene_director."""

from __future__ import annotations

REASONING = "low"  # paid on every chunk of every video — see agents/CLAUDE.md

# Failures here are per scene and bank independently, so a retry costs only the
# scenes that failed. Three rounds is enough for that to converge.
MAX_ATTEMPTS = 3

# Scenes per model call. This decides what one call sees — how much surrounding
# narration the model can vary its imagery against — so it changes the output and
# is not a throughput knob. Raise it and consecutive scenes get more samey; lower
# it and they stop knowing about each other at all.
CHUNK_SIZE = 8

# Chunks in flight. A 2-hour script runs ~180 scenes, so ~23 chunks; calling them
# one after another would blow the bridge timeout.
MAX_PARALLEL_CHUNKS = 8
