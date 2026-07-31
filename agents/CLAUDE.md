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

## Better than validating: ask whether the model is needed at all

There used to be a third agent, `scene_splitter`. Its story is the one to
remember here.

1. **v1** had the model copy each scene's text out verbatim, then healed the
   copy, closed coverage gaps, validated the reassembly and retried four times.
   Six mechanisms, every one of them undoing damage that was only possible
   *because* the model had been handed the text.
2. **v2** asked for the first few words of each scene and sliced the original
   string at them. Lossless coverage stopped being a rule to enforce and became
   the only thing the code could produce. All six mechanisms deleted.
3. **v3** noticed nothing downstream cares *where* a scene starts — one image
   per scene, so a cut landing mid-thought costs nothing measurable. The whole
   agent was deleted for 30 lines of sentence-grouping in
   `lib/scene-engine/cut-script.ts`.

Two questions, in this order, before writing a validator:

- **Does this need a model?** Not "would a model do it better" — would anything
  downstream *measure* the difference.
- If yes: **can it be asked for a decision** (where, which, how many) rather
  than content that has to survive a round trip? Then the check, the repair
  loop and the failure mode all disappear together.

## Bank the good

Where checks can be keyed per item, resend **only** the items that failed. In
`scene_director` that is per scene id: a scene that validated is banked and never
re-requested, so a good answer cannot be corrupted by someone else's retry.

## An agent failing fails the job — unless there is a right answer without it

Each agent is the sole writer of what it produces, so by default a failure
**throws**. A loud stop beats a silent downgrade: a plausible-looking decision
nobody made is worse than a failure, because only the failure gets fixed.

One agent degrades, and it earns it by having a correct answer available that
involves no guessing:

- **`scene_director` fills an undirected scene from its nearest directed
  neighbour** and logs `SALVAGED`. Modal already does this one layer down — a
  scene whose image failed reuses the previous scene's image so audio coverage
  is never lost. Repeating one shot in a two-hour sleep video is a dull minute;
  a failed job is no video. It still throws if it resolved *zero* scenes, since
  then there is no neighbour to inherit from.

`script_context` has no such answer and still throws.

Do not extend this list without the same justification: a degradation is only
sanctioned when the fallback is *derived*, never when it is *plausible*.

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

`shared/config.py` MODEL tracks `lib/ai/openai.ts` DEFAULT_MODEL on purpose: the
story title is still written in TypeScript, and it should not come from a
different model than the scenes it sits over.

## Batch size is a prompt decision, so it lives here

Every agent that works over many items chunks them **itself** — the TS caller
hands over the whole script or the whole scene list in one spawn. Chunk size
decides what a single model call sees, which changes the output; parking it in
`lib/` puts a prompt knob in a file with no prompt in it, two directories from
the thing it affects.

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

## These agents ARE production

All three are wired in. `lib/scene-engine/script-to-scenes.ts` is three bridge
calls and a word-count sum — no prompt, no LLM call, no chunking of its own.
There is no TypeScript path left to fall back to, so a change here changes every
video.

The old TS path was deleted without an A/B — a deliberate call, refine here
instead. The cost is that the first real job after a change is the test.
Reassembly is no longer the thing to watch (it is structural now); what to watch
is **cut quality** — the `[splitter]` line reports how many chunks fell back to
mechanical cuts, and a number that is not zero means the markers are not landing.

```bash
# after a job completes — snippet chars must equal script chars
curl -s https://sleep-stories.up.railway.app/api/jobs/<taskId> -o /tmp/j.json
python3 -c "
import json; d=json.load(open('/tmp/j.json'))
s=d['projectJson']['state']
print(sum(len(x['script_snippet']) for x in s['storyboardScenes']), 'vs', len(s['script']['content']))"
```
