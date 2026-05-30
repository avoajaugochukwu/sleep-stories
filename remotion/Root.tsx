import { Composition } from "remotion";
import { SleepStory } from "./SleepStory";
import { sleepStoryDefaults } from "./defaults";

// NOTE: files under remotion/ are bundled by webpack (Remotion), which does NOT
// read tsconfig `paths` — so imports here use relative paths, never the @/ alias.

export const SLEEP_COMPOSITION_ID = "SleepStory";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={SLEEP_COMPOSITION_ID}
      component={SleepStory}
      durationInFrames={sleepStoryDefaults.durationInFrames}
      fps={sleepStoryDefaults.fps}
      width={sleepStoryDefaults.width}
      height={sleepStoryDefaults.height}
      defaultProps={sleepStoryDefaults}
      // Everything is pre-computed server-side, so metadata just echoes props.
      calculateMetadata={async ({ props }) => ({
        durationInFrames: Math.max(1, props.durationInFrames),
        fps: props.fps,
        width: props.width,
        height: props.height,
        props,
      })}
    />
  );
};
