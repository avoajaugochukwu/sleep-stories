import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";

type Props = {
  src: string;
  durationInFrames: number;
  zoomDirection: "in" | "out";
};

/**
 * Very slow Ken Burns push for a sleep mood — far gentler than a documentary
 * pace. Images are generated 16:9 to match the frame, so we cover-fit and add
 * only a subtle scale + drift. No 3D rock, no blur backdrop: keeps Lambda
 * frame cost low on long renders.
 */
export const KenBurnsImage: React.FC<Props> = ({
  src,
  durationInFrames,
  zoomDirection,
}) => {
  const frame = useCurrentFrame();

  const [from, to] = zoomDirection === "in" ? [1.05, 1.16] : [1.16, 1.05];
  const scale = interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // A few px of vertical drift, opposite to the zoom direction, so the motion
  // feels like a slow breath rather than a straight push.
  const driftSign = zoomDirection === "in" ? -1 : 1;
  const translateY = interpolate(
    frame,
    [0, durationInFrames],
    [0, driftSign * 18],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <AbsoluteFill
        style={{ transform: `scale(${scale}) translateY(${translateY}px)` }}
      >
        <Img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
