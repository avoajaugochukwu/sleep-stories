"""Constants checks.py enforces."""

from __future__ import annotations

# Narration pace. 150 wpm is the figure the app already uses for its read-time
# estimate (app/scenes/page.tsx), so scene durations derived here and read-times
# shown in the UI agree.
WORDS_PER_MINUTE = 150.0
WORDS_PER_SECOND = WORDS_PER_MINUTE / 60.0

# Target scene length. These videos are deliberately slow — the failure mode is
# always too many short scenes, never too few long ones.
TARGET_SECONDS = 20.0

# How far a chunk's scene count may stray from `chunk_words / (target * wps)`
# before it is a problem. Wide, because a chunk that ends mid-paragraph
# legitimately produces an odd last scene; narrow enough to catch the real
# failure — one-scene-per-sentence staccato.
COUNT_TOLERANCE = 2.2

# No chunk may produce fewer than this many scenes unless it is genuinely tiny.
MIN_SCENES = 1
