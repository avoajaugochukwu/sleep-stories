> **Starting a new session? Read `HANDOFF.md` first.** It carries the
> deployed-vs-local divergence and the ordered next steps. This file is the
> running log behind it; `docs/CHANGELOG.md` is the dated history.

# Session log — agent refactor + a second genre (space)

Started 2026-07-30. Two goals, in this order:

1. **Refactor the scene layer into Python agents**, matching the contract in
   `../../../video-agents/military/agents/CLAUDE.md`.
2. **Add a space/cosmos genre** without an `if (genre === 'space')` branch
   anywhere in the app.

(2) is the reason for (1). Both are done.

---

## What happened, in order

1. **Fixed: a prebaked job's render was invisible**, so the UI invited a
   duplicate paid render. The state was already in the store — nothing rendered
   it.
2. **Job queue shipped.** App lands on `/jobs`, jobs get their own URLs,
   `deriveJobState()` is the single place a job's state is decided. Deployed.
3. **Docker replaced Nixpacks** on Railway — the agents need a system python and
   the Nixpacks Next image has none. Surfaced a real bug on the way: Nixpacks
   was leaking runtime env into the build, hiding an eager `openai` client that
   ran at import. Lazy Proxy fixed it. **A build must never need a runtime
   secret.**
4. **Overlays prefixed by pack** (`fire-*`, `space-*`), four space clips added
   and re-encoded, `overlayPack` threaded end to end.
5. **The agent layer was wired into production** and the TypeScript scene path
   deleted. No A/B — deliberate call, refine on the agents instead.
6. **`scene_splitter` was then deleted too.** See below.
7. **Modal redeployed** with the renamed clips. Railway push still pending.

---

## Three reversals worth keeping

**1. Genre is inferred, not configured.** The original plan put an explicit
`genre` on the ingest payload, arguing a silent misread corrupts a whole video.
Overruled: hardcoding genre per board means every new kind of video needs a code
change or a Baserow column. The payload field survives as an override. Measured
4/4 on real scripts, including the trap case — a WWI script describing a shell
burst "like a supernova" classified `history`, not `space`.

**2. There is no overlay agent.** The plan had an `atmosphere_director` picking
clips from a tagged manifest. Prefixing clips by pack collapsed the problem into
`OVERLAY_PACK[genre]`, a dict. The manifest JSON was already written and got
deleted. **Check whether a decision can be made structural before making it
probabilistic.**

**3. `scene_splitter` went through three designs in one day; the third was to
delete it.**

- **v1** had the model copy each scene's text out verbatim, then healed the
  copy, closed coverage gaps, validated the reassembly and retried four times.
  Six mechanisms, every one undoing damage only possible *because* the model had
  been handed the text.
- **v2** asked only for cut markers and sliced the original string at them
  (copied from the military app's `sliceBySnippets`). Lossless coverage stopped
  being a rule to enforce and became the only thing the code could produce. All
  six mechanisms deleted.
- **v3** observed that nothing downstream cares *where* a scene starts — one
  image per scene, so a cut landing mid-thought costs nothing measurable. The
  model call bought a marginally tidier cut for a round trip per chunk plus a
  failure mode. Deleted the agent for ~80 lines of sentence grouping in
  `lib/scene-engine/cut-script.ts`.

The generalised rule now lives in `agents/CLAUDE.md` under "Better than
validating": ask whether the thing needs a model at all before asking how to
validate its output.

---

## Questions this session answered

- **Repo location** — sleep-stories stays at `ui/stories/sleep-stories`; it does
  not move under `video-agents/`.
- **Space board** — there isn't one. ClickUp `901113872792` is named "Midnight
  Mysteries" (`lib/jobs/config.ts` had it labelled "Sleep Stories", now fixed).
  The plausible-looking `901113798933 "Space Cluster"` is footage-collector's
  WW2 board — its tasks are `[Attch] Hitler's Tank Designer…`. Genre rides
  inference on the existing list; no new ClickUp setup needed.
- **`STATUS_DONE` writeback had never worked on this board.** Default is
  `fc done`; the board only had `to do` / `in progress` / `complete`. The call is
  best-effort and caught, so nothing failed — jobs just sat at "in progress"
  forever. The user added `fc done` to the board on 2026-07-31, so it works from
  the next job onward.
- **`STYLE_PREFIX`** — stays global in `lib/jobs/scene-image.ts`, applied at
  generation time so retries stay idempotent. Not per genre; the genre-specific
  half is the negative prompt, which the director owns.
- **`lib/ai/anthropic.ts`** — vestigial, zero importers, same eager-construction
  landmine as the openai client. Deleted; recoverable from git.
