// ============================================================================
// SLEEP STORIES - TYPES
// ============================================================================

// Script the user pastes/loads to break into scenes
export interface Script {
  content: string;
  word_count: number;
  generated_at: Date;
}

// Scene Breakdown - Sleep Stories (no-gap, photographic dark scenes)
export interface Scene {
  scene_number: number;
  script_snippet: string;
  visual_prompt: string; // Dark, calming, photographic image concept
  duration?: number; // Estimated narration seconds for this scene (~30s target)
}

export interface StoryboardScene extends Scene {
  image_url?: string;
  generation_status: 'pending' | 'generating' | 'completed' | 'error';
  error_message?: string;
  is_regenerating?: boolean;
  image_pool_index?: number; // Index in the image pool this scene is using
}

// Narration audio referenced by a URL the user provides (an object already in
// their S3 bucket). We never upload it — we just read its real duration in the
// browser to time the video, then hand the URL straight to the renderer.
export interface AudioAsset {
  url: string; // public or presigned S3 URL to the audio file
  durationSec: number;
}

// A single Lambda render attempt. We keep many so you can fire off multiple
// renders, compare outputs, and not lose track on refresh (persisted to IDB).
export interface RenderJob {
  renderId: string;
  bucketName: string;
  title: string;
  createdAt: number; // epoch ms
  finishedAt?: number; // epoch ms when it reached done/error — freezes elapsed time
  status: 'rendering' | 'done' | 'error';
  progress: number; // 0..1
  outputFile?: string;
  cost?: number;
  error?: string;
}

// Workflow Management
export type WorkflowStep = 1 | 2; // Scenes → Render

export interface SessionStore {
  // Current workflow step
  currentStep: WorkflowStep;

  // Generated content (for scenes/export)
  script: Script | null;
  scenes: Scene[];
  storyboardScenes: StoryboardScene[];

  // Narration audio (collected with the script)
  audio: AudioAsset | null;

  // Render jobs fired off this session (persisted so refresh/failure is safe)
  renders: RenderJob[];

  // Workflow state
  isGenerating: boolean;
  errors: string[];
  sceneGenerationProgress: number;

  // Hydration flag — true once IndexedDB state has loaded on the client.
  _hydrated: boolean;

  // Actions
  setScript: (script: Script) => void;
  setScenes: (scenes: Scene[]) => void;
  setStoryboardScenes: (scenes: StoryboardScene[]) => void;
  updateStoryboardScene: (sceneNumber: number, updates: Partial<StoryboardScene>) => void;
  setAudio: (audio: AudioAsset | null) => void;
  addRender: (job: RenderJob) => void;
  updateRender: (renderId: string, updates: Partial<RenderJob>) => void;
  removeRender: (renderId: string) => void;
  setStep: (step: WorkflowStep) => void;
  setGenerating: (isGenerating: boolean) => void;
  setSceneGenerationProgress: (progress: number) => void;
  addError: (error: string) => void;
  clearErrors: () => void;
  reset: () => void;
}
