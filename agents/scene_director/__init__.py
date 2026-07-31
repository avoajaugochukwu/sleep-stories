"""Scene director.

Turns scene snippets into image prompts. **This is the genre-swappable agent** —
military-history direction and cosmos direction are two blocks in prompt.py, not
two code paths. Nothing in lib/ branches on genre.

Also the home of the SFW clamp, which used to be prose marked ABSOLUTE in the old
TS prompt. Read the honesty note at the top of checks.py: it is a term denylist,
and the image generator's own negative prompt remains the second, independent
gate.

The deterministic parts (checks/schema/prompt) import without the openai SDK;
`direct` is lazy so those can be tested offline.
"""

__all__ = ["direct"]


def __getattr__(name: str):
    if name == "direct":
        from .client import direct

        return direct
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
