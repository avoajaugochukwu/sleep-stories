import {
  getRenderProgress,
  renderMediaOnLambda,
} from "@remotion/lambda/client";
import type { SleepVideoInputProps } from "./types";

const region = process.env.AWS_REGION ?? "us-west-2";

// Speed strategy: fan out into chunks that render in parallel, then a "main"
// Lambda stitches them. Remotion HARD-CAPS this at 200 functions per render
// ("Too many functions" error above that) — independent of our 1500 account
// concurrency, so 200 is the real ceiling, NOT a tunable. Each chunk renders
// totalFrames/200 frames within its own 900s limit; for a ~2.2h story
// (~193k frames) that's ~965 frames/chunk. Memory (10240 MB ≈ 5.8 vCPU) and
// timeout (900s) are already at AWS maximums, so if a single chunk ever nears
// 900s the only remaining levers are fps/resolution, not more fan-out.
const MAX_CHUNKS = 200;
// Small floor so short test clips still split into a few parallel chunks
// instead of one slow Lambda.
const MIN_FRAMES_PER_LAMBDA = 60;

function computeFramesPerLambda(totalFrames: number): number {
  if (totalFrames <= 0) return MIN_FRAMES_PER_LAMBDA;
  return Math.max(MIN_FRAMES_PER_LAMBDA, Math.ceil(totalFrames / MAX_CHUNKS));
}

function slug(input: string | undefined): string {
  const base = (input ?? "sleep-story").toLowerCase();
  return (
    base
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sleep-story"
  );
}

export async function startSleepRender(
  input: SleepVideoInputProps,
): Promise<{ renderId: string; bucketName: string }> {
  const functionName = process.env.REMOTION_LAMBDA_FUNCTION_NAME;
  const serveUrl = process.env.REMOTION_SERVE_URL;
  if (!functionName) {
    throw new Error(
      "REMOTION_LAMBDA_FUNCTION_NAME not set — run `npm run deploy:lambda`",
    );
  }
  if (!serveUrl) {
    throw new Error("REMOTION_SERVE_URL not set — run `npm run deploy:site`");
  }

  // Force OUR dedicated bucket. Without this, Remotion would discover the
  // region's other (production) Remotion bucket and refuse ("multiple buckets").
  const forceBucketName = process.env.REMOTION_RENDER_BUCKET;

  const res = await renderMediaOnLambda({
    region: region as Parameters<typeof renderMediaOnLambda>[0]["region"],
    functionName,
    serveUrl,
    ...(forceBucketName ? { forceBucketName } : {}),
    composition: process.env.REMOTION_COMPOSITION_ID ?? "SleepStory",
    inputProps: input,
    codec: "h264",
    imageFormat: "jpeg",
    privacy: "public",
    jpegQuality: 80,
    framesPerLambda: computeFramesPerLambda(input.durationInFrames),
    // 10240 MB ≈ ~5.8 vCPUs. Render 5 frames in parallel so the cores stay
    // saturated — Lambda bills the single function's wall-time while all 5 cores
    // work, so more frames per billed-second ≈ lower cost per frame (no quality
    // change). ~2 GB/frame headroom at 1080p, comfortably within 10 GB.
    concurrencyPerLambda: 5,
    maxRetries: 2,
    outName: `${slug(input.title)}.mp4`,
  });

  return { renderId: res.renderId, bucketName: res.bucketName };
}

export async function fetchSleepRenderProgress(
  renderId: string,
  bucketName: string,
) {
  const functionName = process.env.REMOTION_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("REMOTION_LAMBDA_FUNCTION_NAME not set");
  }
  return getRenderProgress({
    renderId,
    bucketName,
    functionName,
    region: region as Parameters<typeof getRenderProgress>[0]["region"],
  });
}
