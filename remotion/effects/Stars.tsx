import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

type Star = {
  x: number; // %
  y: number; // %
  size: number; // px
  baseOpacity: number;
  phase: number; // twinkle offset
  period: number; // frames per twinkle cycle
};

const STAR_COUNT = 110;

/**
 * Sparse, slowly twinkling star field with a barely-there downward drift.
 * Adds genuine frame-to-frame motion (a "this is video, not a slideshow"
 * signal) while staying subtle over dark imagery. Positions are computed once
 * (useMemo) and Remotion's deterministic Math.random keeps them stable across
 * the render farm.
 */
export const Stars: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const stars = useMemo<Star[]>(() => {
    return Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 1 + Math.random() * 2.2,
      baseOpacity: 0.35 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      period: 90 + Math.random() * 150,
    }));
  }, []);

  // Whole field drifts down ~3% of frame height over the entire video.
  const driftY = (frame / Math.max(1, durationInFrames)) * 3;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.85 }}>
      {stars.map((s, i) => {
        const twinkle =
          0.45 + 0.55 * Math.sin((frame / s.period) * Math.PI * 2 + s.phase);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${s.x}%`,
              top: `${(s.y + driftY) % 100}%`,
              width: s.size,
              height: s.size,
              borderRadius: "50%",
              background: "rgba(226, 232, 255, 1)",
              opacity: s.baseOpacity * twinkle,
              boxShadow: `0 0 ${s.size * 2}px rgba(190, 210, 255, 0.7)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
