import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { SERIF_FONT } from "../fonts";

type Props = { title: string };

// Timing (seconds): fade in, hold, fade out — all gentle.
const FADE_IN = 2.0;
const HOLD = 4.5;
const FADE_OUT = 2.5;

export const TITLE_TOTAL_SEC = FADE_IN + HOLD + FADE_OUT;

/**
 * A soft, centered title at the very start. Fades up from black, breathes, and
 * dissolves — the only prominent text in the whole piece.
 */
export const TitleCard: React.FC<Props> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = FADE_IN * fps;
  const holdEnd = (FADE_IN + HOLD) * fps;
  const fadeOutEnd = (FADE_IN + HOLD + FADE_OUT) * fps;

  const opacity = interpolate(
    frame,
    [0, fadeIn, holdEnd, fadeOutEnd],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Whisper-slow zoom on the text for a touch of life.
  const scale = interpolate(frame, [0, fadeOutEnd], [1, 1.05], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 120,
        opacity,
      }}
    >
      {/* gentle dark scrim so the title reads over any image */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 70%)",
        }}
      />
      <h1
        style={{
          position: "relative",
          margin: 0,
          fontFamily: SERIF_FONT,
          fontWeight: 500,
          fontSize: 96,
          lineHeight: 1.15,
          letterSpacing: 1,
          textAlign: "center",
          color: "rgba(244, 244, 255, 0.96)",
          textShadow: "0 2px 30px rgba(0,0,0,0.65)",
          transform: `scale(${scale})`,
          maxWidth: "80%",
        }}
      >
        {title}
      </h1>
    </AbsoluteFill>
  );
};
