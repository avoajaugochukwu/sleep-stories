"""Prompt for scene_director.

**This file is the entire genre surface of the app.** A genre is a base brief
plus one block below. Adding a third genre means adding an entry to GENRE_BRIEFS,
an entry to GENRE_NEGATIVES, and the name to shared/genres.py — and touching no
TypeScript at all. If a new genre needs an app-code change, the change is in the
wrong place. See agents/CLAUDE.md.

The `history` blocks are lifted from the era/technology sections of the old
lib/scene-engine/sleep-scene-prompt.ts, which is where they belonged all along —
they were only ever correct for one genre, and they were sitting in the prompt
every genre had to use.
"""

from __future__ import annotations

from .schema import MAX_NEGATIVE_WORDS, MAX_WORDS, MIN_WORDS

_BASE = """You write image prompts for the scenes of a long-form, slow-paced \
sleep video. You are given the narration for each scene; you write what the \
viewer sees while it is read.

For each scene write TWO things.

**visual_context** — {min_words}-{max_words} words. One image prompt that is:

- **Anchored in the narration.** The main subject must come from THAT scene's \
text, not from the video's general topic.
- **A single clear subject.** One hero subject holding the frame, clean \
composition, uncluttered background. A busy frame reads as noise at this size.
- **Explicitly lit.** Always state the lighting, chosen for the scene — not a \
default. Say where the light comes from and what colour it is.
- **Vividly coloured.** Deep, clean, saturated colour. NEVER grey, desaturated, \
washed-out, muddy or dull. No yellow, amber or sepia cast. No teal-and-orange \
grade. Do not add filters, haze, grain or overlays unless the scene literally \
contains them (real fog, real firelight, a real dust storm).
- **Composed plainly.** Describe framing in plain words — a wide view, a close \
view, the subject centred.

Do NOT name an art style, medium, camera, lens or film look. A style is applied \
automatically to every prompt, and naming a second one fights it. Do not ask for \
text, captions, watermarks or logos in the image.

**negative_prompt** — a short comma-separated list, at most {max_neg} words, of \
what must NOT appear in THIS scene. Specific to this scene's subject and setting. \
Do not repeat generic quality terms (blurry, extra fingers, watermark) — those \
are added automatically.

## SAFE FOR A GENERAL AUDIENCE

Every scene must be family-friendly. Never write nudity, sexual or suggestive \
content, gore, blood, wounds, corpses, graphic violence or horror imagery — \
whatever the narration describes. If the narration covers a battle, a death, an \
injury or a disaster, depict it tastefully and bloodlessly: a distant silhouette, \
an empty landscape, a symbolic object, an aftermath with nothing graphic in \
frame. When in doubt choose the calmer, more abstract image. This overrides every \
other instruction here.

{genre_brief}"""


# ── Genre briefs ────────────────────────────────────────────────────────────
# What "correct imagery" means for this genre. One block per genre.

GENRE_BRIEFS: dict[str, str] = {
    "history": """## PERIOD AND PLACE ACCURACY

Lock every scene to the exact era and place in the grounding above.

- **Clothing, uniforms, armour and architecture** must match that specific year \
or decade — not a generic or nearby-era version. Uniforms and fashion change \
decade by decade: a 1914 soldier is not a 1944 soldier is not a 2025 soldier; \
1600s Italian dress is not 1800s dress; Roman clothing is togas and tunics, not \
medieval robes.
- **Technology is period-locked.** Only tools, vehicles, weapons, light sources \
and materials that actually existed in that era and place may appear. A Roman or \
1600s scene has NO cars, electric light, power lines, telephones, plastic, glass \
skyscrapers or printed signage — only period-correct oil lamps, candles, horses, \
timber and stone. A modern scene uses its real contemporary technology.

Anachronistic technology is the single worst error you can make here.

Each negative_prompt should name the anachronisms most likely to leak into THAT \
scene — for a pre-industrial scene: cars, electricity, power lines, telephones, \
wristwatches, plastic, modern clothing, printed signs.""",

    "space": """## PHYSICAL ACCURACY IN SPACE

Lock every scene to the scale and light in the grounding above. Space imagery \
fails by looking like a poster, not by looking boring.

- **Scale is a decision.** A moon, a gas giant, a star and a galaxy are not shot \
the same way. State which you are looking at and from how far.
- **Light has one source, usually.** Name the star and its real colour (a red \
dwarf is not the Sun), or the reflected planetlight, or the accretion glow. \
Shadow terminators in vacuum are HARD — no soft atmospheric falloff, no fill \
light from nowhere.
- **Vacuum has no air.** No haze, no dust motes in a sunbeam, no wind, no \
contrails, no sound cues. Stars do not twinkle. Distant objects do not fade with \
distance the way they do through atmosphere.
- **Real colour.** Nebulae are not uniformly purple and pink; name the actual \
emission colour. Planets have real surface character — Mars is a dusty ochre, \
not orange; Europa is cracked white ice, not blue.
- **Silence and stillness read as calm.** Prefer a still, vast composition over a \
dramatic one. This is a sleep video, not a trailer.

Each negative_prompt should name the space-art clichés most likely to leak into \
THAT scene — cartoon planets, lens flare starbursts, wrong-colour nebulae, \
visible sound effects, atmospheric haze in vacuum, Earth-like gravity cues, \
sci-fi spacecraft when none is in the narration.""",

    "abstract": """## IMAGERY WITHOUT A SETTING

This script may have no fixed place or period. Do not invent one and do not force \
consistency the narration never asked for.

- Draw the image from the sensation, material or metaphor the narration is \
actually about — water, cloth, light on a surface, a slow natural process.
- Keep it physical. An abstract narration still needs a concrete, drawable \
subject; "peace" is not an image, still water under low light is.
- Favour simple, calm subjects with a lot of empty space in the frame.

Each negative_prompt should exclude what would break the calm for THAT scene — \
crowds, clutter, harsh light, busy patterns, human faces where none is intended.""",
}


# Appended to every negative_prompt for this genre, on top of what the model
# wrote. Constant per genre, so there is no reason to spend model tokens on it.
GENRE_NEGATIVES: dict[str, str] = {
    "history": "anachronistic technology, modern clothing, modern signage",
    "space": "cartoon planets, lens flare starburst, atmospheric haze in vacuum, twinkling stars",
    "abstract": "clutter, busy background, harsh direct light",
}


def build_prompt(
    context: dict,
    genre: str,
    scenes: list[dict],
    feedback: str = "",
) -> list[dict]:
    """`scenes` is [{"id": int, "snippet": str}, ...] — only the ids still needed."""
    system = _BASE.format(
        min_words=MIN_WORDS,
        max_words=MAX_WORDS,
        max_neg=MAX_NEGATIVE_WORDS,
        genre_brief=GENRE_BRIEFS.get(genre, GENRE_BRIEFS["history"]),
    )

    parts = []
    summary = (context or {}).get("summary", "").strip()
    grounding = (context or {}).get("grounding", "").strip()
    subjects = (context or {}).get("recurring_subjects") or []
    if summary:
        parts.append(f"## This video\n{summary}")
    if grounding:
        parts.append(f"## Grounding — every scene must respect this\n{grounding}")
    if subjects:
        parts.append(
            "## Recurring subjects — these must look the same in every scene\n"
            + "\n".join(f"- {s}" for s in subjects)
        )

    listing = "\n\n".join(f"[{s['id']}] {s['snippet']}" for s in scenes)
    parts.append(f"## Scenes to write ({len(scenes)})\n{listing}")
    parts.append(
        "Answer with one entry per scene id above — exactly these ids, no others."
    )

    user = "\n\n".join(parts)
    if feedback:
        user += f"\n\n## Fix Required\n{feedback}"

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
