"""The genre registry.

A genre is the ONLY thing that differs between a military-history sleep video and
a cosmos one. It selects a block in `scene_director/prompt.py` and shapes what
`script_context` puts in its `grounding` field. Nothing in `lib/` branches on it.

Adding a genre:
  1. add it here
  2. add its block to scene_director/prompt.py GENRE_BRIEFS
  3. add its negatives to scene_director/prompt.py GENRE_NEGATIVES

No app code changes. If step 4 exists, it is in the wrong place.

`abstract` is not a subject genre — it is the escape hatch for a script with no
physical setting at all (a guided meditation, pure imagery). It is the one genre
allowed to return empty grounding.
"""

from __future__ import annotations

GENRES = ("history", "space", "abstract")

DEFAULT_GENRE = "history"

# Genres that legitimately have nothing to ground: no era, no place, no scale.
UNGROUNDED = frozenset({"abstract"})

# Which ambient overlay pack the renderer should draw from — the FILENAME PREFIX
# in public/overlays. `modal_app.py` lists `<pack>-*.mp4` at render time, so this
# map plus a correctly-named file is the entire mechanism.
#
# There is deliberately no agent for this. Once the clips are prefixed by pack,
# "which overlays suit this video" collapses into "what is this video about",
# which script_context already answers. A model call here would add a failure
# mode and decide nothing extra.
#
# `abstract` gets the fire pack because it is the neutral one: smoke and haze sit
# under anything. The space pack is cosmic-specific and would read as a mistake
# over a forest or a hearth.
OVERLAY_PACK = {
    "history": "fire",
    "space": "space",
    "abstract": "fire",
}

DEFAULT_PACK = "fire"


def overlay_pack(genre: str | None) -> str:
    return OVERLAY_PACK.get(normalize(genre), DEFAULT_PACK)


def normalize(genre: str | None) -> str:
    """Unknown or missing genre falls back to the default rather than raising.

    Deliberate: a genre typo in a Baserow row should ship a slightly-wrong video,
    not fail a job at minute 40 of image generation. The check that matters —
    that the DIRECTOR received a genre it has a brief for — is the same fallback,
    applied in one place.
    """
    g = (genre or "").strip().lower()
    return g if g in GENRES else DEFAULT_GENRE
