// Ambient beds offered in the render UI. The KEY (`fire` | `meditation`, or
// `none`) is all that's sent to Modal — Modal owns the actual audio files and
// mix levels. Only the label is used on this side (the radio list).
export const SOUND_EFFECTS = {
  fire: { label: "Fire crackling" },
  meditation: { label: "Meditation ambient" },
} as const;

export type SoundEffectKey = keyof typeof SOUND_EFFECTS;
