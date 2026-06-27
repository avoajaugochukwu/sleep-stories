import type { StoryboardScene } from "@/lib/types";

// Cheap ffmpeg renderer on Modal (~10× cheaper than Remotion-Lambda). Same HTTP
// contract the old Lambda path exposed, so callers only swap the transport.
// See render-modal/README.md. Override the URL with RENDER_API_BASE if redeployed.
const RENDER_API_BASE =
  process.env.RENDER_API_BASE ||
  "https://avoajaugochukwu--sleep-render-web.modal.run";

export interface ModalStartResult {
  renderId: string;
  bucketName: string;
  title: string;
  durationInFrames: number;
  sceneCount: number;
}

export async function startModalRender(body: {
  scenes: StoryboardScene[];
  audioUrl: string;
  audioDurationSec: number;
  soundEffect?: string;
  title?: string;
}): Promise<ModalStartResult> {
  const res = await fetch(`${RENDER_API_BASE}/render/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`render/start failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<ModalStartResult>;
}

export interface ModalProgress {
  done: boolean;
  overallProgress: number;
  outputFile: string | null;
  fatalErrorEncountered: boolean;
  errors: unknown[];
  costsAccrued: number | null;
}

export async function fetchModalRenderProgress(
  renderId: string,
): Promise<ModalProgress> {
  const res = await fetch(`${RENDER_API_BASE}/render/${renderId}`);
  if (!res.ok) {
    throw new Error(`render status failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<ModalProgress>;
}
