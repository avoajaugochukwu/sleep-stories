import {
  getRenderProgress,
  renderMediaOnLambda,
} from "@remotion/lambda/client";
import type { SleepVideoInputProps } from "./types";

const region = process.env.AWS_REGION ?? "us-west-2";

// Speed strategy: fan out into as many chunks as Remotion allows (hard cap
// 200) so that, once the account concurrency increase lands (10 -> 5000),
// nearly the whole video renders in parallel. Until then chunks simply queue
// 10-at-a-time, so there's no downside to maximising the fan-out now.
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
    // 10240 MB ≈ 6 vCPUs, so render 4 frames in parallel inside each Lambda.
    // Combined with the fan-out and us-west-2's 1500 concurrency limit, even
    // long narrations render fast.
    concurrencyPerLambda: 4,
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
