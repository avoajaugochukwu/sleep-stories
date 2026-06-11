// Export / import the whole working session as a single portable JSON file.
//
// Everything that defines a workflow already lives as plain data in the store:
// the script, the scene breakdown, the storyboard (fal.ai image URLs), the
// narration (an S3 audio URL) and the render history. None of the heavy assets
// are inlined — images and audio are links — so the file stays tiny and a
// colleague who imports it points at the exact same assets and gets the exact
// same render. Export → import → export round-trips losslessly.

import { saveAs } from 'file-saver';
import { useSessionStore } from '@/lib/store';
import type {
  Script,
  Scene,
  StoryboardScene,
  AudioAsset,
  RenderJob,
  WorkflowStep,
} from '@/lib/types';

const APP_ID = 'sleep-stories' as const;
export const WORKFLOW_FILE_VERSION = 1;

// The persisted slice of the session, mirroring the store's `partialize`.
export interface WorkflowState {
  currentStep: WorkflowStep;
  script: Script | null;
  scenes: Scene[];
  storyboardScenes: StoryboardScene[];
  audio: AudioAsset | null;
  renders: RenderJob[];
}

export interface WorkflowExport {
  app: typeof APP_ID;
  version: number;
  exportedAt: string; // ISO timestamp
  state: WorkflowState;
}

export interface WorkflowSummary {
  scenes: number;
  images: number;
  hasAudio: boolean;
  words: number;
  exportedAt?: string;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function snapshotState(): WorkflowState {
  const s = useSessionStore.getState();
  return {
    currentStep: s.currentStep,
    script: s.script,
    scenes: s.scenes,
    storyboardScenes: s.storyboardScenes,
    audio: s.audio,
    renders: s.renders,
  };
}

function workflowFilename(state: WorkflowState, isoDate: string): string {
  const firstWords = state.script?.content.trim().split(/\s+/).slice(0, 5).join('-') ?? '';
  const slug = firstWords.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-') || 'workflow';
  return `sleep-stories-${slug.slice(0, 40)}-${isoDate.slice(0, 10)}.json`;
}

/**
 * Serialize the current session and trigger a file download. Returns a result
 * the caller can surface as a toast instead of throwing/alerting.
 */
export function exportWorkflow(): { ok: boolean; reason?: string } {
  const state = snapshotState();
  if (!state.script && state.storyboardScenes.length === 0) {
    return { ok: false, reason: 'Nothing to export yet — add a script first.' };
  }
  const exportedAt = new Date().toISOString();
  const payload: WorkflowExport = { app: APP_ID, version: WORKFLOW_FILE_VERSION, exportedAt, state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  saveAs(blob, workflowFilename(state, exportedAt));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ParsedWorkflow {
  state: WorkflowState;
  summary: WorkflowSummary;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Validate and normalize a workflow file's text. Throws an Error with a
 * human-readable message the caller can show in a toast.
 */
export function parseWorkflowFile(text: string): ParsedWorkflow {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Unrecognised workflow file.');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.app !== APP_ID) {
    throw new Error('This doesn’t look like a Sleep Stories workflow file.');
  }
  const incoming = obj.state;
  if (!incoming || typeof incoming !== 'object') {
    throw new Error('Workflow file is missing its data.');
  }
  const s = incoming as Record<string, unknown>;

  // Revive the one non-JSON-native field so the store stays type-consistent.
  let script: Script | null = null;
  if (s.script && typeof s.script === 'object') {
    const sc = s.script as Record<string, unknown>;
    const when = new Date(sc.generated_at as string);
    script = {
      content: String(sc.content ?? ''),
      word_count: Number(sc.word_count ?? 0),
      generated_at: isNaN(when.getTime()) ? new Date() : when,
    };
  }

  const storyboardScenes = asArray<StoryboardScene>(s.storyboardScenes);
  const stepRaw = Number(s.currentStep);
  const state: WorkflowState = {
    currentStep: (stepRaw === 2 ? 2 : 1) as WorkflowStep,
    script,
    scenes: asArray<Scene>(s.scenes),
    storyboardScenes,
    audio: (s.audio && typeof s.audio === 'object' ? (s.audio as AudioAsset) : null),
    renders: asArray<RenderJob>(s.renders),
  };

  if (!state.script && state.storyboardScenes.length === 0) {
    throw new Error('This workflow file is empty.');
  }

  const summary: WorkflowSummary = {
    scenes: state.storyboardScenes.length || state.scenes.length,
    images: state.storyboardScenes.filter((sc) => !!sc.image_url).length,
    hasAudio: !!state.audio?.url,
    words: state.script?.word_count ?? 0,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : undefined,
  };

  return { state, summary };
}

/**
 * Replace the live session with an imported workflow. The persist middleware
 * writes the new state to IndexedDB automatically.
 */
export function applyWorkflow(state: WorkflowState): void {
  useSessionStore.setState({
    currentStep: state.currentStep,
    script: state.script,
    scenes: state.scenes,
    storyboardScenes: state.storyboardScenes,
    audio: state.audio,
    renders: state.renders,
  });
}

/** Summary of what's currently loaded, used to warn before an import overwrites it. */
export function currentWorkflowSummary(): WorkflowSummary | null {
  const s = snapshotState();
  if (!s.script && s.storyboardScenes.length === 0) return null;
  return {
    scenes: s.storyboardScenes.length || s.scenes.length,
    images: s.storyboardScenes.filter((sc) => !!sc.image_url).length,
    hasAudio: !!s.audio?.url,
    words: s.script?.word_count ?? 0,
  };
}
