"""Scene splitter.

Turns one chunk of narration into the exact stretches of text each scene covers.
Genre-blind: it decides WHERE a scene starts and stops, never what it looks like.

Its guarantee is mechanical, so `checks.py` owns it — the snippets must
concatenate back into the input chunk character-for-character, because the
finished video aligns narration audio against them.

Ported from healSnippet/closeCoverageGaps in lib/scene-engine/no-gap-breakdown.ts.

The deterministic parts (checks/schema) import without the openai SDK; `split` is
lazy so those can be tested offline.
"""

__all__ = ["split"]


def __getattr__(name: str):
    if name == "split":
        from .client import split

        return split
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
