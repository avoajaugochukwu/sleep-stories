/**
 * Node → Python agent bridge.
 *
 * Every agent is a subprocess: JSON on stdin, JSON on stdout, logs on stderr.
 * `cwd: AGENT_DIR` is the linchpin — it is why agents are addressed as
 * `-m <agent>` rather than `-m agents.<agent>`, why `from shared import config`
 * resolves inside them, and why the health route spawns with the same cwd. The
 * bridge and the health route must agree on it.
 *
 * There is no fallback. Each agent is the sole writer of what it produces, so a
 * failure throws and the job stops. See agents/CLAUDE.md.
 *
 * Ported from ../../../../video-agents/military/lib/agents/bridge.ts.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

export const AGENT_DIR = path.join(process.cwd(), 'agents');

// A flat cap is wrong: cost scales with how much text an agent is asked to
// handle, so one number is either too tight for a long chunk or too slack for a
// short one. Scaled per unit of work, the ceiling tracks the work.
const TIMEOUT_FLOOR_MS = 180_000;
const TIMEOUT_PER_SCENE_MS = 4_000;
const TIMEOUT_PER_KB_MS = 8_000;
const TIMEOUT_CEILING_MS = 600_000; // a hang must still end; above this it is broken, not slow

/**
 * Two cost drivers, whichever the payload exposes: scene count (scene_director)
 * or text length (script_context).
 */
function timeoutFor(payload: unknown): number {
  const p = payload as { scenes?: unknown; script?: string };
  const scenes = Array.isArray(p?.scenes) ? p.scenes.length : 0;
  const chars = p?.script?.length ?? 0;
  const need = scenes * TIMEOUT_PER_SCENE_MS + (chars / 1024) * TIMEOUT_PER_KB_MS;
  return Math.min(TIMEOUT_CEILING_MS, Math.max(TIMEOUT_FLOOR_MS, Math.round(need)));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function secs(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

/** Only a JSON.parse failure needs stdout quoted back — for every other reason
 *  the message already says everything and stdout is just noise. A stray
 *  print() on the deterministic path lands here. */
function stdoutHint(err: unknown, raw: string): string {
  if (!(err instanceof SyntaxError) || !raw) return '';
  return `; stdout head: ${JSON.stringify(raw.slice(0, 200))}`;
}

function spawnAgent(agent: string, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-m', agent], { cwd: AGENT_DIR, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${agent} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      // The thrown message keeps a tail so the job's stored error stays
      // readable, but a 300-char tail of a Python traceback names the decoder,
      // never the frame that called it. Emit the whole thing once, here, or the
      // only copy of it dies with the subprocess.
      if (stderr.trim()) console.error(`[agents] ${agent} stderr:\n${stderr.trim()}`);
      reject(
        new Error(
          `subprocess exited ${code}; stderr tail: ${stderr.trim().slice(-300) || '(empty)'}`,
        ),
      );
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Run one agent and return the WHOLE parsed object. `requireKey` is asserted so a
 * malformed answer fails loudly rather than surfacing as `undefined` downstream.
 *
 * Every failure below throws with its own specific reason; the single catch
 * re-throws it as one loud, labelled error. `raw` is hoisted so stdoutHint can
 * reach it from the catch.
 */
export async function runAgentRaw(
  agent: string,
  payload: unknown,
  requireKey: string,
  summarize: (obj: Record<string, unknown>) => string,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  let raw = '';
  try {
    raw = await spawnAgent(agent, JSON.stringify(payload), timeoutFor(payload));
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!(requireKey in parsed)) throw new Error(`output JSON had no \`${requireKey}\` key`);
    console.log(`[agents] ${agent} OK — ${summarize(parsed)} in ${secs(startedAt)}`);
    return parsed;
  } catch (err) {
    // No fallback verdict: there is nothing to fall back to. One catch, one
    // throw — the caller aborts the job and the reason travels with the error.
    throw new Error(`[agents] ${agent} FAILED — ${message(err)}${stdoutHint(err, raw)}`);
  }
}

/** Run one agent and return just the value at `expectKey`. */
export async function runAgent<T>(
  agent: string,
  payload: unknown,
  expectKey: string,
  summarize: (result: T) => string,
): Promise<T> {
  const parsed = await runAgentRaw(agent, payload, expectKey, (obj) =>
    summarize(obj[expectKey] as T),
  );
  return parsed[expectKey] as T;
}

// ── Typed wrappers, one per agent ───────────────────────────────────────────
// The `[agents] <name> OK — <counts>` line carries counts, not just "OK":
// an OK with no numbers proves nothing (agents/CLAUDE.md).

export interface ScriptContext {
  summary: string;
  grounding: string;
  recurring_subjects: string[];
  genre: string;
  /** Derived from genre in agents/shared/genres.py — the overlay filename prefix. */
  overlay_pack: string;
}

export async function runScriptContext(
  script: string,
  genre?: string,
): Promise<ScriptContext> {
  const out = await runAgentRaw('script_context', { script, genre }, 'summary', (o) => {
    const subjects = (o.recurring_subjects as string[] | undefined)?.length ?? 0;
    return `genre=${o.genre}, ${(o.summary as string).split(' ').length}w summary, ${subjects} recurring subjects`;
  });
  return out as unknown as ScriptContext;
}

export interface DirectedScene {
  id: number;
  visual_context: string;
  negative_prompt: string;
}

export async function runSceneDirector(
  scenes: { id: number; snippet: string }[],
  context: Partial<ScriptContext>,
  genre?: string,
): Promise<DirectedScene[]> {
  return runAgent<DirectedScene[]>(
    'scene_director',
    { scenes, context, genre },
    'scenes',
    (out) => `${out.length} scenes directed (genre=${genre ?? context.genre ?? 'default'})`,
  );
}
