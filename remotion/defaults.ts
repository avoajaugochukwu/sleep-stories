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
  };
});

export const sleepStoryDefaults: SleepVideoInputProps = {
  audioUrl:
    "https://remotion-assets.s3.eu-central-1.amazonaws.com/example-audio.mp3",
  fps,
  width: 3840,
  height: 2160,
  durationInFrames: cursor,
  title: "A Quiet Night",
  scenes,
  crossfadeFrames: Math.round(1.2 * fps),
  // Preview-only sample schedule; real renders randomise this (all six clips,
  // random timing/length/speed) in build-input.ts → scheduleOverlays().
  overlays: [
    {
      src: "overlays/light_white_smoke_rising_from_bottom.mp4",
      durationInSeconds: 40.95,
      startFrame: 0,
      durationInFrames: 30 * fps,
      fadeFrames: Math.round(2.5 * fps),
      playbackRate: 0.35,
      opacity: 0.22,
    },
    {
      src: "overlays/blue_smoke_later_in_video.mp4",
      durationInSeconds: 20,
      startFrame: 33 * fps,
      durationInFrames: 20 * fps,
      fadeFrames: Math.round(2.5 * fps),
      playbackRate: 0.3,
      opacity: 0.24,
      flip: true,
    },
  ],
  // Preview-only sample; real renders derive these from the script via AI
  // (lib/scene-engine/story-text.ts).
  textOverlays: [
    {
      text: "drifting somewhere quiet",
      startFrame: 12 * fps,
      durationInFrames: Math.round(7.7 * fps),
      fadeFrames: Math.round(1.6 * fps),
    },
  ],
  // Looping fire-crackling bed under the narration; toggled per render in the UI.
  soundEffect: {
    src: "sound-effects/soundreality-fire-ambience-528618.mp3",
    volume: 0.18,
  },
};
