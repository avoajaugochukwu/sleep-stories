import { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

type Cloud = {
  y: number; // %
  size: number; // % of width
  fromX: number; // %
  toX: number; // %
  opacity: number;
  tint: string;
};

const CLOUD_COUNT = 5;

/**
 * Slow translucent fog banks drifting horizontally. Each drifts linearly
 * across the whole video (no looping = no popping), at a different height and
 * speed. Heavy blur + low opacity keeps it as atmosphere, not a focal point.
 */
export const Clouds: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const clouds = useMemo<Cloud[]>(() => {
    return Array.from({ length: CLOUD_COUNT }, (_, i) => {
      const leftToRight = i % 2 === 0;
      const tints = [
        "rgba(120,140,200,0.9)",
        "rgba(90,110,170,0.9)",
        "rgba(150,160,210,0.9)",
      ];
      return {
        y: 8 + Math.random() * 70,
        size: 45 + Math.random() * 45,
        fromX: leftToRight ? -40 - Math.random() * 30 : 80 + Math.random() * 40,
        toX: leftToRight ? 90 + Math.random() * 40 : -50 - Math.random() * 30,
        opacity: 0.05 + Math.random() * 0.05,
        tint: tints[i % tints.length],
      };
    });
  }, []);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {clouds.map((c, i) => {
        const x = interpolate(frame, [0, durationInFrames], [c.fromX, c.toX], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: `${c.y}%`,
              left: `${x}%`,
              width: `${c.size}%`,
              height: `${c.size * 0.55}%`,
              background: `radial-gradient(ellipse at center, ${c.tint} 0%, rgba(0,0,0,0) 68%)`,
              opacity: c.opacity,
              filter: "blur(40px)",
              mixBlendMode: "screen",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
