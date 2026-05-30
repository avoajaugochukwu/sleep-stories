import { create } from 'zustand';
import { SessionStore, WorkflowStep } from './types';

const initialState = {
  currentStep: 1 as WorkflowStep,
  script: null,
  scenes: [],
  storyboardScenes: [],
  isGenerating: false,
  errors: [],
  sceneGenerationProgress: 0,
};

export const useSessionStore = create<SessionStore>((set) => ({
  ...initialState,

  setScript: (script) => set({ script }),

  setScenes: (scenes) => set({ scenes }),

  setStoryboardScenes: (scenes) => set({ storyboardScenes: scenes }),

  updateStoryboardScene: (sceneNumber, updates) =>
    set((state) => ({
      storyboardScenes: state.storyboardScenes.map((scene) =>
        scene.scene_number === sceneNumber ? { ...scene, ...updates } : scene
      ),
    })),

  setStep: (step) => set({ currentStep: step }),

  setGenerating: (isGenerating) => set({ isGenerating }),

  setSceneGenerationProgress: (progress) => set({ sceneGenerationProgress: progress }),

  addError: (error) =>
    set((state) => ({
      errors: [...state.errors, error],
    })),

  clearErrors: () => set({ errors: [] }),

  reset: () => set(initialState),
}));
