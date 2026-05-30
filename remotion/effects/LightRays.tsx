import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

/**
 * Soft volumetric "god rays" sloping in from the top. A couple of blurred,
 * skewed gradient beams that slowly breathe in intensity and shift angle —
 * a calm cinematic glow rather than animation. Kept low-opacity so it reads as
 * light, not a shape.
 */
export const LightRays: React.FC = () => {
  const frame = useCurrentFrame();

  // ~24s breathing cycle for the overall intensity.
  const breathe = 0.5 + 0.5 * Math.sin((frame / 720) * Math.PI * 2);
  const intensity = interpolate(breathe, [0, 1], [0.05, 0.12]);

  // Very slow angle wander, ±2deg over a long period.
  const angle = 16 + 2 * Math.sin((frame / 1100) * Math.PI * 2);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {/* warm top-corner glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 80% at 72% -10%, rgba(255, 226, 170, 0.5) 0%, rgba(255,226,170,0) 55%)",
          opacity: intensity,
          mixBlendMode: "screen",
        }}
      />
      {/* angled beams */}
      <div
        style={{
          position: "absolute",
          top: "-40%",
          left: "30%",
          width: "55%",
          height: "180%",
          transform: `rotate(${angle}deg)`,
          transformOrigin: "top center",
          background:
            "linear-gradient(90deg, rgba(255,240,210,0) 0%, rgba(255,240,210,0.6) 45%, rgba(255,240,210,0) 60%, rgba(200,220,255,0.4) 80%, rgba(200,220,255,0) 100%)",
          filter: "blur(36px)",
          opacity: intensity * 0.9,
          mixBlendMode: "screen",
        }}
      />
    </AbsoluteFill>
  );
};
