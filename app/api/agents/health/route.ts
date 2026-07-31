/**
 * GET /api/agents/health — "did the agents actually run?", answerable with one curl.
 *
 * A broken python layer fails every job outright — no agent has a fallback.
 * This route is the standing answer: python runtime, whether each agent runs,
 * and whether keys are present.
 *
 * ONE mechanism: each agent is invoked for real with an EMPTY payload, and
 * everything else is derived from that. A successful invoke transitively proves
 * python works AND `import openai` resolved, so there is no separate preflight
 * to drift out of sync.
 *
 * Empty input is free: every agent returns before any model call
 * (agents/CLAUDE.md), so this needs no API key and costs nothing, while still
 * exercising the import graph, the cwd and the stdout contract — which is where
 * failures actually are.
 *
 * NEVER returns key values — only 'set'/'missing'.
 *
 * EVERY NEW AGENT IS REGISTERED HERE.
 */
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { AGENT_DIR } from '@/lib/agents/bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT_MS = 30_000;

/** agent module -> [empty payload, key its result must carry] */
const AGENTS: Record<string, [unknown, string]> = {
  script_context: [{ script: '' }, 'summary'],
  scene_director: [{ scenes: [] }, 'scenes'],
};

interface Probe {
  importable: boolean;
  /** Interpreter version, scraped from the probe's own stderr marker. */
  python: string | null;
  error?: string;
}

export async function GET() {
  const names = Object.keys(AGENTS);
  const probes = await Promise.all(
    names.map((n) => probeAgent(n, AGENTS[n][0], AGENTS[n][1])),
  );

  // Runtime is DERIVED from the invokes above, not separately measured. If an
  // agent ran, python and openai are both necessarily fine.
  const ok = probes.every((p) => p.importable);
  const failure = probes.find((p) => !p.importable);

  return NextResponse.json({
    runtime: {
      ok,
      python: probes.find((p) => p.python)?.python ?? null,
      openai: ok,
      ...(ok ? {} : { error: failure?.error ?? 'unknown' }),
    },
    agents: Object.fromEntries(names.map((n, i) => [n, strip(probes[i])])),
    keys: { OPENAI_API_KEY: present('OPENAI_API_KEY') },
  });
}

/** `python` is an implementation detail of the probe, reported once under runtime. */
function strip(p: Probe): { importable: boolean; error?: string } {
  return p.importable ? { importable: true } : { importable: false, error: p.error };
}

/** Never the value — only whether it exists and is non-empty. */
function present(name: string): 'set' | 'missing' {
  return process.env[name]?.trim() ? 'set' : 'missing';
}

/**
 * Run one agent on an empty payload; confirm exit 0 and parseable JSON carrying
 * the expected result key.
 *
 * Invoked via runpy rather than a bare `-m` so the same single spawn can also
 * report the interpreter version on STDERR — stdout stays the wire (see
 * agents/CLAUDE.md), and `run_name='__main__'` makes runpy execute exactly what
 * `python3 -m <agent>` executes, including its SystemExit code.
 */
function probeAgent(module: string, payload: unknown, expectKey: string): Promise<Probe> {
  const bootstrap =
    'import sys, runpy; ' +
    "print('PYVER=' + sys.version.split()[0], file=sys.stderr); " +
    `runpy.run_module(${JSON.stringify(module)}, run_name='__main__')`;

  return new Promise<Probe>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('python3', ['-c', bootstrap], { cwd: AGENT_DIR, env: process.env });
    } catch (err) {
      resolve({ importable: false, python: null, error: `spawn failed: ${message(err)}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (r: Probe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ importable: false, python: null, error: `timed out after ${PROBE_TIMEOUT_MS}ms` });
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (err) =>
      done({ importable: false, python: null, error: `python3 not runnable: ${message(err)}` }),
    );
    child.on('close', (code) => {
      const python = /PYVER=(\S+)/.exec(stderr)?.[1] ?? null;
      // Strip the marker so it never shows up in a reported error tail.
      const tail = stderr.replace(/PYVER=\S+\n?/, '').trim().slice(-300);
      if (code !== 0) {
        done({ importable: false, python, error: `exited ${code}; stderr tail: ${tail || '(empty)'}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        if (!(expectKey in parsed)) {
          done({ importable: false, python, error: `output JSON had no \`${expectKey}\` key` });
          return;
        }
        done({ importable: true, python });
      } catch (err) {
        done({
          importable: false,
          python,
          // A stray print() on the deterministic path lands here.
          error: `stdout was not JSON (${message(err)}); head: ${JSON.stringify(stdout.slice(0, 200))}`,
        });
      }
    });

    child.stdin?.write(JSON.stringify(payload));
    child.stdin?.end();
  });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
