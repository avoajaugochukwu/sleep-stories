import { loadFont } from "@remotion/google-fonts/EBGaramond";

// EB Garamond — soft, literary serif that suits a calm bedtime feel. loadFont()
// registers a delayRender internally so the Lambda render waits for the font.
const { fontFamily } = loadFont("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

export const SERIF_FONT = fontFamily;
