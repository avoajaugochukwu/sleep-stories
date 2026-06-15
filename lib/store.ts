import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { SessionStore, WorkflowStep } from './types';

// IndexedDB key for the persisted session. Used both by the persist middleware
// and by reset(), so it must stay a single source of truth.
const STORAGE_KEY = 'sleep-stories-session';

const initialState = {
  currentStep: 1 as WorkflowStep,
  script: null,
  scenes: [],
  storyboardScenes: [],
  audio: null,
  renders: [],
  isGenerating: false,
  errors: [],
  sceneGenerationProgress: 0,
};

// Only the durable parts of the session are persisted — never transient flags
// like isGenerating/errors/progress. This is what survives a refresh or a
// failed step (notably the expensive generated images and the render list).
type PersistedState = Pick<
  SessionStore,
  'currentStep' | 'script' | 'scenes' | 'storyboardScenes' | 'audio' | 'renders'
>;

// IndexedDB-backed storage. We store the StorageValue object directly (not a
// JSON string) so structured clone preserves types like Date on
// script.generated_at. Falls back gracefully on the server (no window).
const idbStorage: PersistStorage<PersistedState> = {
  getItem: async (name) => {
    if (typeof window === 'undefined') return null;
    return ((await idbGet(name)) as StorageValue<PersistedState> | undefined) ?? null;
  },
  setItem: async (name, value) => {
    if (typeof window === 'undefined') return;
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    if (typeof window === 'undefined') return;
    await idbDel(name);
  },
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      ...initialState,
      _hydrated: false,

      setScript: (script) => set({ script }),

      setScenes: (scenes) => set({ scenes }),

      setStoryboardScenes: (scenes) => set({ storyboardScenes: scenes }),

      updateStoryboardScene: (sceneNumber, updates) =>
        set((state) => ({
          storyboardScenes: state.storyboardScenes.map((scene) =>
            scene.scene_number === sceneNumber ? { ...scene, ...updates } : scene
          ),
        })),

      setAudio: (audio) => set({ audio }),

      addRender: (job) =>
        set((state) => ({ renders: [job, ...state.renders] })),

      updateRender: (renderId, updates) =>
        set((state) => ({
          renders: state.renders.map((r) =>
            r.renderId === renderId ? { ...r, ...updates } : r
          ),
        })),

      removeRender: (renderId) =>
        set((state) => ({
          renders: state.renders.filter((r) => r.renderId !== renderId),
        })),

      setStep: (step) => set({ currentStep: step }),

      setGenerating: (isGenerating) => set({ isGenerating }),

      setSceneGenerationProgress: (progress) => set({ sceneGenerationProgress: progress }),

      addError: (error) =>
        set((state) => ({
          errors: [...state.errors, error],
        })),

      clearErrors: () => set({ errors: [] }),

      reset: () => {
        // Clear in-memory state AND delete the persisted IndexedDB entry.
        // Without the explicit delete, the old session rehydrates on the next
        // load (or wins the race against an in-flight hydration), so "Start
        // Over" appears to do nothing — the session comes back.
        set({ ...initialState });
        void idbDel(STORAGE_KEY);
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: idbStorage,
      partialize: (state): PersistedState => ({
        currentStep: state.currentStep,
        script: state.script,
        scenes: state.scenes,
        storyboardScenes: state.storyboardScenes,
        audio: state.audio,
        renders: state.renders,
      }),
      onRehydrateStorage: () => () => {
        useSessionStore.setState({ _hydrated: true });
      },
    }
  )
);
