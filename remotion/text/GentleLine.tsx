import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { SERIF_FONT } from "../fonts";

type Props = {
  text: string;
  /** Length of the host scene, in frames — the line lives inside this window. */
  sceneDurationInFrames: number;
};

const FADE = 1.6; // seconds for each fade
const HOLD = 4.0; // seconds fully visible

/**
 * A rare, quiet line in the lower third. Fades in, holds a few seconds, fades
 * out — it never competes with the imagery. Rendered inside its scene's
 * Sequence, slightly after the scene begins.
 */
export const GentleLine: React.FC<Props> = ({ text, sceneDurationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lead = Math.round(1.0 * fps); // small delay after the cut
  const fade = FADE * fps;
  const local = frame - lead;
  const visibleEnd = fade + HOLD * fps;
  const total = visibleEnd + fade;

  // Don't run past the end of the scene.
  if (local < 0 || local > Math.min(total, sceneDurationInFrames - lead)) {
    return null;
  }

  const opacity = interpolate(
    local,
    [0, fade, visibleEnd, total],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const translateY = interpolate(local, [0, fade], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "16%",
        display: "flex",
        justifyContent: "center",
        padding: "0 12%",
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
          fontSize: 44,
          lineHeight: 1.3,
          textAlign: "center",
          color: "rgba(238, 240, 255, 0.92)",
          letterSpacing: 0.5,
          textShadow: "0 2px 24px rgba(0,0,0,0.75)",
        }}
      >
        {text}
      </p>
    </div>
  );
};
