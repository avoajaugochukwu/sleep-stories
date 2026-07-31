"""Prompt for script_context.

The genre shapes WHAT grounding means, never whether there is a grounding field.
That is the seam: one free-text slot, genre-specific content. See agents/CLAUDE.md.
"""

from __future__ import annotations

from .schema import MAX_SCRIPT_CHARS, SUMMARY_MAX_WORDS

_SYSTEM = """You are a script analyst for long-form, slow-paced sleep videos.

You read a narration script once and produce the grounding that every scene in \
the finished video will inherit. You are not writing scenes and not describing \
images — you are establishing the facts that keep dozens of separate scene \
prompts consistent with each other.

Return {count} things:
{genre_task}

`summary` — {max_summary} words maximum. The central topic, the overall tone, \
and the setting. This is prepended to every scene prompt, so every word is paid \
once per chunk. Be dense.

`grounding` — the physical constraints the imagery must respect. {grounding}

`recurring_subjects` — the named things that appear in more than one part of \
the script and must look the same each time (a specific person, a named ship, a \
particular building or planet). Only things that genuinely recur. An empty list \
is a valid answer for a script that never revisits a subject.

Do not invent facts the script does not support. If the script is vague about \
something, say it is vague rather than filling it in — a confident wrong era or \
a confident wrong scale propagates into every scene of a multi-hour video."""

# Genre-shaped guidance for the `grounding` field only. The slot is identical
# across genres; this is what goes in it.
_GROUNDING: dict[str, str] = {
    "history": (
        "Pin the period to an exact year or decade where the script allows "
        '("France, 1916", not "the early 20th century"), name the place, and '
        "state the period-accurate clothing, uniforms, architecture and "
        "technology the subject implies. Say explicitly what did NOT exist yet — "
        "anachronistic technology is the single worst error downstream. Uniforms "
        "and fashion change decade by decade: name the specifics for THIS era, "
        "never a generic version."
    ),
    "space": (
        "State the physical scale (planetary, stellar, galactic — a moon and a "
        "nebula are not shot the same way), the real light sources and their "
        "colour (star type, reflected planetlight, accretion glow), and what "
        "vacuum does: no atmospheric haze, no sound, no wind, hard shadow "
        "terminators, stars that do not twinkle. Name the actual bodies the "
        "script is about and their real colour and surface character. If the "
        "script is speculative or far-future, say so — that licenses invention "
        "the observed-astronomy framing would otherwise forbid."
    ),
    "abstract": (
        "This script may have no physical setting at all. If it genuinely does "
        "not — a guided meditation, pure sensation, imagery with no place — "
        "return an empty grounding rather than inventing a setting to fill the "
        "field. If it DOES have a recurring physical world, describe that world's "
        "materials, light and scale instead."
    ),
}


# Shown only when the caller did NOT pin a genre. Each line has to be enough to
# classify on, because the model picks and grounds in the same pass.
_GENRE_MENU = """`genre` — classify this script as exactly one of:

  - `history` — a real time and place on Earth. War, a trade, a city, a life. \
Anything whose imagery depends on getting a period right.
  - `space` — astronomy and the universe. Planets, moons, stars, deep space, \
spacecraft, cosmic scale. Anything shot in or about a vacuum.
  - `abstract` — no fixed place or period at all: a guided meditation, pure \
sensation, imagery with no world behind it. Use this ONLY when there is \
genuinely no setting; a dreamlike story that still happens somewhere is \
`history`.

Choose on what the script is ABOUT, not on a passing mention — a WWI script that \
compares a shell burst to a supernova is still `history`. If it is genuinely \
mixed, choose the one that governs most of the running time."""


def build_prompt(script: str, genre: str | None, feedback: str = "") -> list[dict]:
    """`genre=None` asks the model to classify; a string pins it.

    Classification and grounding happen in ONE call rather than two agents,
    because the grounding IS the classification worked out in detail — splitting
    them would mean a second round trip whose only input is the first one's
    label, for no extra decision. See agents/CLAUDE.md on one job per agent.
    """
    inferring = genre is None
    system = _SYSTEM.format(
        count="four" if inferring else "three",
        genre_task=f"\n{_GENRE_MENU}\n" if inferring else "",
        max_summary=SUMMARY_MAX_WORDS,
        grounding=(
            "Its content depends on the genre you just chose:\n\n"
            + "\n\n".join(f"  - for `{g}`: {t}" for g, t in _GROUNDING.items())
            if inferring
            else _GROUNDING.get(genre, _GROUNDING["history"])
        ),
    )
    header = "Script:" if inferring else f"Script (genre: {genre}):"
    user = f'{header}\n\n"""\n{script[:MAX_SCRIPT_CHARS]}\n"""'
    if feedback:
        user += f"\n\n## Fix Required\n{feedback}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
