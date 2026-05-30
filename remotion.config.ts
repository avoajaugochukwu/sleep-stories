import { Config } from "@remotion/cli/config";

// Sleep Stories render config. We keep the bundle dependency-light (no Tailwind
// inside remotion/) so deploySite needs no webpack override.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
