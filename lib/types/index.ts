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

// Narration audio, uploaded alongside the script. Stored as an S3 object key
// (private) plus the real measured duration used to time the video.
export interface AudioAsset {
  key: string; // S3 object key (audio/...)
  fileName: string;
  durationSec: number;
  sizeBytes: number;
}

// Workflow Management
export type WorkflowStep = 1 | 2 | 3; // Scenes → Render → Export

export interface SessionStore {
  // Current workflow step
  currentStep: WorkflowStep;

  // Generated content (for scenes/export)
  script: Script | null;
  scenes: Scene[];
  storyboardScenes: StoryboardScene[];

  // Narration audio (collected with the script)
  audio: AudioAsset | null;

  // Workflow state
  isGenerating: boolean;
  errors: string[];
  sceneGenerationProgress: number;

  // Actions
  setScript: (script: Script) => void;
  setScenes: (scenes: Scene[]) => void;
  setStoryboardScenes: (scenes: StoryboardScene[]) => void;
  updateStoryboardScene: (sceneNumber: number, updates: Partial<StoryboardScene>) => void;
  setAudio: (audio: AudioAsset | null) => void;
  setStep: (step: WorkflowStep) => void;
  setGenerating: (isGenerating: boolean) => void;
  setSceneGenerationProgress: (progress: number) => void;
  addError: (error: string) => void;
  clearErrors: () => void;
  reset: () => void;
}
