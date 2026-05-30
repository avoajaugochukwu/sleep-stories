import {
  getRenderProgress,
  renderMediaOnLambda,
} from "@remotion/lambda/client";
import type { SleepVideoInputProps } from "./types";

const region = process.env.AWS_REGION ?? "us-east-1";

// Remotion caps a render at 200 Lambda chunks. Keep chunks reasonably sized so
// long sleep narrations (which can be hours) still fit under the cap.
const MAX_CHUNKS = 190;
const MIN_FRAMES_PER_LAMBDA = 100;

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

  const res = await renderMediaOnLambda({
    region: region as Parameters<typeof renderMediaOnLambda>[0]["region"],
    functionName,
    serveUrl,
    composition: process.env.REMOTION_COMPOSITION_ID ?? "SleepStory",
    inputProps: input,
    codec: "h264",
    imageFormat: "jpeg",
    privacy: "public",
    jpegQuality: 80,
    framesPerLambda: computeFramesPerLambda(input.durationInFrames),
    concurrencyPerLambda: 1,
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
