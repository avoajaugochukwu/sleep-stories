import type { SleepVideoInputProps } from "../lib/remotion/types";

// Sample props so `npm run studio` previews something. The audio is a short
// public-domain clip; scenes use Picsum placeholders. Real renders always pass
// fully-computed props (see lib/remotion/build-input.ts), so this is preview-only.
const fps = 30;

function placeholder(seed: string): string {
  return `https://picsum.photos/seed/${seed}/1920/1080`;
}

const sceneSeconds = [8, 7, 9, 6, 8, 7, 8];
let cursor = 0;
const scenes = sceneSeconds.map((sec, i) => {
  const durationInFrames = sec * fps;
  const startFrame = cursor;
  cursor += durationInFrames;
  return {
    id: `scene-${i + 1}`,
    imageUrl: placeholder(`sleep-${i + 1}`),
    startFrame,
    durationInFrames,
    zoom: (i % 2 === 0 ? "in" : "out") as "in" | "out",
    caption:
      i === 3 ? "drifting somewhere quiet and far away" : undefined,
  };
});

export const sleepStoryDefaults: SleepVideoInputProps = {
  audioUrl:
    "https://remotion-assets.s3.eu-central-1.amazonaws.com/example-audio.mp3",
  fps,
  width: 1920,
  height: 1080,
  durationInFrames: cursor,
  title: "A Quiet Night",
  scenes,
  crossfadeFrames: Math.round(1.2 * fps),
};
