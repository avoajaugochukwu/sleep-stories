"""Script context.

Reads the whole script once and produces the grounding every later scene inherits:
what the video is about, its tone, and the physical constraints its imagery must
respect.

Replaces GLOBAL_CONTEXT_PROMPT in lib/scene-engine/sleep-scene-prompt.ts, which
ordered the model to pin an exact year ("France, 1916") — a military-history
assumption baked into the one call whose job is to discover what the script IS.
On a cosmos script it invented a period and every downstream scene inherited it.

The deterministic parts (checks/schema) import without the openai SDK; `build` is
lazy so those can be tested offline.
"""

__all__ = ["build"]


def __getattr__(name: str):
    if name == "build":
        from .client import build

        return build
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
