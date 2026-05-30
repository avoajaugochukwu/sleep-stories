import { AbsoluteFill, useCurrentFrame } from "remotion";

// A tiling fractal-noise SVG (stitched, so it wraps seamlessly). We shift its
// background-position every frame to make the grain shimmer like real film.
const NOISE_TILE = 168;
const NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='168' height='168'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * Film grain + edge vignette. Cheap to render and the single strongest
 * "this is a video, not a still slideshow" signal — moving grain gives every
 * frame a unique footprint, and the vignette focuses the eye toward center.
 */
export const GrainVignette: React.FC = () => {
  const frame = useCurrentFrame();

  const bgX = (frame * 7) % NOISE_TILE;
  const bgY = (frame * 11) % NOISE_TILE;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* moving grain */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: NOISE_URL,
          backgroundSize: `${NOISE_TILE}px ${NOISE_TILE}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          opacity: 0.06,
          mixBlendMode: "overlay",
        }}
      />
      {/* vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 75% 75% at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)",
          mixBlendMode: "multiply",
        }}
      />
    </AbsoluteFill>
  );
};
