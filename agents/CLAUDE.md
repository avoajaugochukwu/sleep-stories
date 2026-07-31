# `agents/` — operating rules

Rules for working on the Python agents. **Not documentation** — each agent's own
README carries its I/O contract. This file only carries what changes what you do.

Ported from `../../../../video-agents/military/agents/CLAUDE.md`, which earned
these rules the hard way. Read that file too; the rules below are the same rules,
with this app's differences called out.

## stdout is the wire. Guard it.

The TS side runs each agent as a subprocess and `JSON.parse`s **stdout**. So:

- **stdout carries the result JSON and nothing else.** Every log, warning and
  progress line goes to **stderr**.
- A stray `print()` anywhere on the deterministic path breaks the parse and the
  bridge turns that into a failed job. Easiest way to break an agent by accident.
- **Exit nonzero on failure.** Never exit 0 with a half-result.

## The LLM judges; code enforces

The model makes the creative call — where a scene starts, what the shot is of.
`checks.py` owns the rules: coverage, caps, word bands, denylists.

**Never move a cap or a ban into a prompt.** A prompt is a suggestion; a clamp is
a guarantee. The SFW rule in the old `lib/scene-engine/sleep-scene-prompt.ts` was
prose marked `ABSOLUTE`, which is exactly the mistake — it now lives in
`scene_director/checks.py`.

## One job per agent

An agent that owns two decisions is two agents. The prompt this layer replaces
owned five — splitting, verbatim coverage, visual authoring, period lock and
negative prompts — which is why changing the art direction meant editing the
string that guaranteed audio alignment.

## Genre lives in the instruction, never in a branch

There is no `if genre == "space"` anywhere in `lib/`. A genre is a block in
`scene_director/prompt.py` plus an entry in `shared/genres.py`. If adding a
third genre needs an app-code change, the change is in the wrong place.

`script_context` emits genre-shaped *content* into a genre-neutral *slot*
(`grounding` is one free-text field, deliberately not `{era, place, technology}`).
That is the seam that keeps the rest of the pipeline genre-blind.

## Validate → repair, don't coerce

Bad model output feeds a problems list back into a `## Fix Required` block and
retries (bounded, default 3), then raises. Do **not** silently coerce a malformed
field into something plausible — that hides a prompt regression and ships a bad
video instead of failing the job.

Every problem string names the offending id and states the fix. These strings go
verbatim into the repair prompt, so "invalid field" is useless there.

**One sanctioned coercion: `scene_splitter`'s gap closing.** Reassigning an
uncovered run of text to its neighbouring snippet is a *deterministic repair with
one correct answer*, not a guess — it is the ported `closeCoverageGaps`, and it
is what makes byte-exact coverage achievable at all. It runs before validation,
and validation still has to pass afterwards.

## Bank the good

Where checks can be keyed per item, resend **only** the items that failed. In
`scene_director` that is per scene id: a scene that validated is banked and never
re-requested, so a good answer cannot be corrupted by someone else's retry.

## An agent failing fails the job

Each agent is the sole writer of what it produces, so a failure **throws**. A
loud stop beats a silent downgrade.

**No agent here is allowed to degrade.** Military grants `graphics_director` an
exception because graphics are additive polish; nothing in this app is. A scene
with no image prompt is a scene with no image.

Note what did NOT become an agent for this reason: the story title
(`lib/scene-engine/story-text.ts`) has a legitimate heuristic fallback and a
render must never block on it. Converting it would force a throw where a fallback
is correct. It stays in TypeScript.

## No tools

Nothing here has one, and `shared/llm.py` has no tool loop to give you. Military's
`search_term` earns its tool because its output can be checked against reality
before committing; no decision in this pipeline can. Adding a tool means adding
the loop back, with tests.

## Tests must run offline

The deterministic path must import and test **without `openai` installed and
without an API key**. Hence the lazy export in `__init__.py`: importing
`checks`/`schema` must not pull `shared/llm.py` into the import graph.

- `python3 agents/<name>/test_<name>.py` — plain asserts, no pytest, no network.
- Test the deterministic half (coverage, caps, denylists). Never test against the
  real model.
- Change a cap or a rule → add the assert in the same change.

## Every agent must be LOUD

One decisive line per invocation from the TS bridge, `[agents]` prefixed:

- `[agents] <name> OK — <counts> in <elapsed>` — carry counts. "OK" with no
  numbers proves nothing.
- `[agents] <name> SKIPPED — <reason>` — only for input with no work in it.
- Failure is the thrown error's own message: `[agents] <name> FAILED — <reason>`.

## Empty input returns before any model call

`client.py` must return before touching the model when its input is empty.
`/api/agents/health` invokes every agent on an empty payload — that is what makes
the check free, keyless and offline. Break it and the health route starts needing
an API key.

A new agent is not done until it is registered in the health route.

## Model / effort convention

**Effort is `low`. All agents, no exceptions without a measured reason.** It is
paid on every chunk of every video.

Set it in the agent's own `config.py`, never by editing `shared/config.py` out
from under another agent.

`shared/config.py` MODEL tracks `lib/ai/openai.ts` DEFAULT_MODEL on purpose: a
scene written by an agent and one written by the legacy TS path should not differ
because they asked different models.

## Dependencies ship in the app container

`agents/requirements.txt` installs into the same image that serves the web app.
Keep it minimal — currently just `openai`.

## Adding a new agent

1. Folder with `__main__.py` (stdin→stdout JSON), `prompt.py`, `client.py`
   (validate→repair loop), `checks.py` (deterministic rules), `schema.py`.
2. Reuse `shared/llm.py` + `shared/config.py`. Add your own `config.py`.
3. Offline `test_<name>.py` covering the deterministic half.
4. A `README.md` with the exact I/O contract.
5. TS bridge call with the `[agents]` logging above.
6. Register it in `app/api/agents/health/route.ts`.

## Prove before wiring

A new agent replacing existing output gets A/B'd against the current TS path on
real jobs before it is wired in. **Nothing in this folder is wired in yet** —
`lib/scene-engine/no-gap-breakdown.ts` still drives production.

`scene_splitter` is the one that can break existing videos: audio alignment
depends on snippets reconstructing the script exactly. Its A/B is a byte-for-byte
diff of the reassembled script on a real 2-hour job, not a spot check.
