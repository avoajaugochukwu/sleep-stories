"""Constants checks.py enforces.

The two denylists here mirror what `lib/jobs/scene-image.ts` already sends as a
negative prompt on every image. That duplication is deliberate: this catches the
model WRITING the thing, the negative prompt catches the generator DRAWING it.
Two independent gates, neither trusted alone. See the SFW note in checks.py.
"""

from __future__ import annotations

# Word band for visual_context. Long enough to be specific (subject, setting,
# lighting, colour), short enough that the generator does not lose the subject in
# a wall of qualifiers.
MIN_WORDS = 35
MAX_WORDS = 90

MAX_NEGATIVE_WORDS = 45

# `lib/jobs/scene-image.ts` prepends STYLE_PREFIX ("highly detailed digital
# painting, ") to every prompt. A style, medium, camera or lens word written HERE
# fights that prefix — two style declarations in one prompt is how a scene comes
# back looking like neither.
STYLE_WORDS = (
    "photo", "photograph", "photorealistic", "photoreal", "cinematic",
    "film still", "35mm", "50mm", "85mm", "dslr", "bokeh", "lens", "camera",
    "shot on", "close-up shot", "wide-angle lens", "telephoto", "macro lens",
    # "digital painting" is THE one that matters: STYLE_PREFIX is literally
    # "highly detailed digital painting, ". The old TS prompt named that phrase
    # while telling the model not to use a style word, which primed it to write
    # it anyway — 77 of 176 scenes in the live Somme job came out as
    # "highly detailed digital painting, highly detailed digital painting: …".
    # prompt.py deliberately never quotes the phrase; this catches it regardless.
    "digital painting", "highly detailed digital painting",
    "oil painting", "watercolour", "watercolor", "sketch", "illustration",
    "anime", "cartoon", "3d render", "octane", "unreal engine", "cgi",
    "concept art", "matte painting", "vector art", "pixel art",
    "hdr", "vignette", "film grain", "sepia", "vintage filter", "instagram",
)

# Text in a generated image is always an artifact — it comes out garbled and it
# is never wanted here.
TEXT_WORDS = ("text", "caption", "subtitle", "watermark", "logo", "signature", "written words")

# SFW denylist. Mirrors SFW_NEGATIVE in lib/jobs/scene-image.ts.
# Read the honesty note in checks.py before trusting this.
SFW_WORDS = (
    "nsfw", "nude", "nudity", "naked", "topless", "sexual", "sexually", "erotic",
    "porn", "suggestive", "cleavage", "lingerie", "fetish",
    "gore", "gory", "blood", "bloody", "bleeding", "wound", "wounds", "wounded",
    "injury", "injured", "mutilation", "mutilated", "dismemberment",
    "dismembered", "decapitation", "decapitated", "corpse", "corpses",
    "dead body", "dead bodies", "viscera", "guts", "entrails", "carnage",
    "massacre", "slaughter", "torture", "horror", "gruesome", "grisly",
)
