# Project guide for Claude

Next.js app that turns a script + narration audio into a Remotion sleep video:
UI breaks the script into scenes + images → uploads audio to S3 → Lambda renders
the composition (crossfading scenes, slow stars/fog/light-rays/grain) to S3.

## Always-on rules

**Auto-redeploy — do not ask.** The Lambda renders the **deployed site bundle**,
not local files. When you edit files that affect what runs on Lambda, redeploy in
the background:

- `npm run deploy:site` — after changes to `remotion/**`, `remotion.config.ts`,
  or any `lib/*` file imported by the Remotion bundle (currently
  `lib/remotion/types.ts`). Re-bundles + uploads to the same URL; no env change.
- `npm run deploy:lambda` — after changes to `scripts/deploy-lambda.mjs`, or when
  the `@remotion/lambda` version actually moves. Never deploy a function whose
  name would collide with prod's (`…mem10240mb-disk10240mb…`).

Verify the exit code when each job completes; non-zero = stale code on Lambda.

**Type-check after edits.** Run `npx tsc --noEmit` after editing any `.ts`/`.tsx`
(the Next build also type-checks, but tsc is faster for a quick pass).

## AWS facts (don't relearn these)

- Region **us-west-2** (same as the remotion-test-2 production stack, for its
  1500 Lambda concurrency).
- Our **own dedicated bucket** `remotionlambda-uswest2-sleepstories` — nothing
  shared with prod. Holds `audio/` (uploads), `renders/` (output),
  `sites/sleep-stories/` (the bundle); 7-day lifecycle on `audio/` + `renders/`.
- Our **own function** `remotion-render-4-0-451-mem10240mb-disk2048mb-900sec` —
  distinct from prod's `…disk10240mb…`, so prod is never touched.
- Two `remotionlambda-…` buckets exist in the region, so `renderMediaOnLambda`
  passes `forceBucketName` (= `REMOTION_RENDER_BUCKET`) to pick ours. Expected,
  not a workaround — Remotion otherwise refuses to guess between buckets.
- Config + AWS keys are in `.env.local` (gitignored).

## Where to look

- `remotion/` — the video composition (bundled by Webpack; relative imports only,
  the `@/` alias does not work here).
- `lib/remotion/` — input builder, Lambda client, shared types.
- `app/api/render/*` — start a render + poll progress; `app/api/renders` lists the
  last 7 days from our bucket.
