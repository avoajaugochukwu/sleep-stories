import { AbsoluteFill, Audio, interpolate, Sequence, useCurrentFrame } from "remotion";
import type { SleepVideoInputProps } from "../lib/remotion/types";
import { KenBurnsImage } from "./scenes/KenBurnsImage";
import { Stars } from "./effects/Stars";
import { Clouds } from "./effects/Clouds";
import { LightRays } from "./effects/LightRays";
import { GrainVignette } from "./effects/GrainVignette";
import { TitleCard } from "./text/TitleCard";
import { GentleLine } from "./text/GentleLine";

/**
 * One crossfading image layer. It starts at its scene's startFrame and lingers
 * `crossfadeFrames` into the next scene (except the last), fading IN over the
 * first crossfade window. Because later scenes paint on top, the incoming
 * scene dissolves over the outgoing one — a soft blend, never a slide — while
 * each scene's START stays frame-exact so audio sync is preserved.
 */
const SceneLayer: React.FC<{
  imageUrl: string;
  durationInFrames: number;
  crossfadeFrames: number;
  zoom: "in" | "out";
  isLast: boolean;
}> = ({ imageUrl, durationInFrames, crossfadeFrames, zoom, isLast }) => {
  const frame = useCurrentFrame();
  const cf = Math.max(1, crossfadeFrames);
  const opacity = interpolate(frame, [0, cf], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const linger = isLast ? 0 : cf;
  return (
    <AbsoluteFill style={{ opacity }}>
      <KenBurnsImage
        src={imageUrl}
        durationInFrames={durationInFrames + linger}
        zoomDirection={zoom}
      />
    </AbsoluteFill>
  );
};

export const SleepStory: React.FC<SleepVideoInputProps> = ({
  audioUrl,
  durationInFrames,
  title,
  scenes,
  crossfadeFrames,
}) => {
  const last = scenes.length - 1;
  return (
    <AbsoluteFill style={{ backgroundColor: "#04060d" }}>
      <Audio src={audioUrl} />

      {/* Scene images — soft crossfade between them. */}
      {scenes.map((s, i) => (
        <Sequence
          key={s.id}
          from={s.startFrame}
          durationInFrames={s.durationInFrames + (i === last ? 0 : crossfadeFrames)}
        >
          <SceneLayer
            imageUrl={s.imageUrl}
            durationInFrames={s.durationInFrames}
            crossfadeFrames={crossfadeFrames}
            zoom={s.zoom}
            isLast={i === last}
          />
        </Sequence>
      ))}

      {/* Ambient motion layers — continuous across the whole piece. */}
      <Clouds />
      <Stars />
      <LightRays />

      {/* Film grain + vignette sit above the imagery. */}
      <GrainVignette />

      {/* Rare gentle lines, each living inside its scene's window. */}
      {scenes.map((s) =>
        s.caption ? (
          <Sequence
            key={`cap-${s.id}`}
            from={s.startFrame}
            durationInFrames={s.durationInFrames}
          >
            <GentleLine
              text={s.caption}
              sceneDurationInFrames={s.durationInFrames}
            />
          </Sequence>
        ) : null,
      )}

      {/* Opening title. */}
      {title ? (
        <Sequence from={0} durationInFrames={durationInFrames}>
          <TitleCard title={title} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
