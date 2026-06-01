import {
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import { SERIF_FONT } from "../fonts";
import type { StoryTextOverlay } from "../../lib/remotion/types";

/**
 * AI-written captions in the lower-LEFT, appearing a few minutes apart across
 * the video. Soft italic serif matching the title card — fades in, drifts up a
 * touch, holds, fades out. Never competes with the imagery.
 */
const Line: React.FC<{ o: StoryTextOverlay }> = ({ o }) => {
  const frame = useCurrentFrame(); // local to this caption's Sequence
  const { durationInFrames, fadeFrames } = o;

  // Clamp fade to STRICTLY under half the caption so the 4-point envelope stays
  // strictly increasing — otherwise a short caption (duration <= 2*fadeFrames)
  // makes the middle keyframes collide/cross and interpolate throws
  // "inputRange must be strictly monotonically increasing".
  const fade = Math.min(fadeFrames, Math.floor((durationInFrames - 1) / 2));

  const opacity = interpolate(
    frame,
    [0, fade, durationInFrames - fade, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const translateY = interpolate(frame, [0, fade], [10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: "7%",
        bottom: "13%",
        maxWidth: "60%",
        opacity,
        transform: `translateY(${translateY}px)`,
        pointerEvents: "none",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: SERIF_FONT,
          fontWeight: 400,
          fontStyle: "italic",
          fontSize: 46,
          lineHeight: 1.3,
          textAlign: "left",
          color: "rgba(238, 240, 255, 0.92)",
          letterSpacing: 0.5,
          textShadow: "0 2px 26px rgba(0,0,0,0.8)",
        }}
      >
        {o.text}
      </p>
    </div>
  );
};

export const StoryCaptions: React.FC<{ overlays: StoryTextOverlay[] }> = ({
  overlays,
}) => {
  return (
    <>
      {overlays.map((o, i) => (
        <Sequence
          key={`${o.startFrame}-${i}`}
          from={o.startFrame}
          durationInFrames={o.durationInFrames}
        >
          <Line o={o} />
        </Sequence>
      ))}
    </>
  );
};
