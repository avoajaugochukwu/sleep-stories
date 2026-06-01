import {
  AbsoluteFill,
  interpolate,
  Loop,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { SleepOverlay } from "../../lib/remotion/types";

/**
 * Ambient video overlays — real footage of smoke / fog / light wisps shot on a
 * black background. We composite them with `mixBlendMode: "screen"`, so pure
 * black contributes nothing and only the bright moving texture adds over the
 * scene. That means NO alpha keying / black-removal is needed: keying out black
 * would also eat the faint grey wisps (the whole point of the clip) and leave
 * halos, whereas screen blend keeps every soft gradient cleanly.
 *
 * All six clips take turns across the timeline (schedule built in
 * build-input.ts): each appearance plays for a random window, looped + slowed,
 * fading in and out so nothing pops on or off. Which clips show, when, for how
 * long, how fast and how bright are all randomised per render.
 */

/** A single scheduled appearance: looped, slowed clip with a fade envelope. */
const OverlayClip: React.FC<{ o: SleepOverlay }> = ({ o }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame(); // local to this appearance's Sequence

  // Timeline frames one full play of the clip occupies. At playbackRate r
  // (<1 = slower), media time = frame * r / fps, so the clip is exhausted after
  // durationInSeconds * fps / r timeline frames. Loop repeats that window.
  const loopFrames = Math.max(
    1,
    Math.floor((o.durationInSeconds * fps) / o.playbackRate) - 1,
  );

  // Fade in/out, clamped to STRICTLY under half the appearance. Using
  // floor(duration/2) lets the two middle keyframes collide when duration is
  // even (e.g. dur 102, fade 51 -> [0,51,51,102]), which makes interpolate throw
  // "inputRange must be strictly monotonically increasing". (duration-1)/2
  // guarantees duration-fade > fade for any duration >= 3 (overlay durations are
  // always >= fadeFrames, so far larger than that).
  const fade = Math.min(o.fadeFrames, Math.floor((o.durationInFrames - 1) / 2));
  const env = interpolate(
    frame,
    [0, fade, o.durationInFrames - fade, o.durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        mixBlendMode: "screen",
        opacity: o.opacity * env,
      }}
    >
      <Loop durationInFrames={loopFrames}>
        <OffthreadVideo
          src={staticFile(o.src)}
          muted
          playbackRate={o.playbackRate}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: o.flip ? "scaleX(-1)" : undefined,
          }}
        />
      </Loop>
    </AbsoluteFill>
  );
};

export const OverlayVideos: React.FC<{ overlays: SleepOverlay[] }> = ({
  overlays,
}) => {
  return (
    <>
      {overlays.map((o, i) => (
        <Sequence
          key={`${o.src}-${o.startFrame}-${i}`}
          from={o.startFrame}
          durationInFrames={o.durationInFrames}
        >
          <OverlayClip o={o} />
        </Sequence>
      ))}
    </>
  );
};
