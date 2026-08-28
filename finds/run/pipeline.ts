/**
 * The stage runner behind finds/run/daily.ts.
 *
 * WHY A RUNNER AND NOT A SHELL SCRIPT OF `&&`s. The interesting part of a
 * daily pipeline is not the happy path, it is what happens when one stage
 * fails. `a && b && c` gives every failure the same answer -- stop -- and
 * DECISIONS D3 says that is wrong: a source being unreachable must be
 * reported DOWN and the run must carry on with the others, while an
 * unreachable database must stop everything. Those two need different
 * answers, so the policy is data on each stage rather than shell operators.
 *
 * WHY SUBPROCESSES AND NOT IMPORTS. Every lane owns its own module and this
 * lane composes them without editing them (finds-coord DEPENDENCIES.md file
 * ownership). Each lane already ships a runnable entry point with a real
 * exit code; spawning it takes that contract at face value, keeps one
 * stage's crash from taking down the runner, and means a lane can change its
 * internals without changing this file. Child output is inherited, not
 * captured: the run log shows exactly what the lane actually printed.
 *
 * NO FAKE GREEN (D6). A stage that did not run is reported as not run, never
 * as a success. A stage that exits 0 without producing the artifact it
 * promised is a FAILURE here, not a pass -- see `produces` below. And the
 * runner never prints an environment variable's value, only its name.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/* ========================================================================== */
/* what a stage is                                                             */
/* ========================================================================== */

export interface StageCommand {
  /** argv, run through `node`. e.g. ['finds/sources/run-hn.ts']. */
  args: string[];
  timeoutMs: number;
  /**
   * Environment variable NAMES this stage cannot run without. Absent =>
   * the stage is BLOCKED and says which name was missing. The value is
   * never read here and never printed anywhere.
   */
  needsEnv?: string[];
  /** Files an earlier stage must have produced. Absent => BLOCKED. */
  needsFile?: string[];
  /**
   * Files this stage promises to have written when it exits 0. A stage that
   * exits 0 without them is recorded as FAILED. This is the guard against
   * the worst outcome available to us: a green run that sent nothing.
   */
  produces?: string[];
}

export interface Stage {
  id: string;
  /** One line, in plain words, so the run log explains itself. */
  what: string;
  /** The lane that owns the module this stage invokes. */
  owner: string;
  /**
   * null means: this stage is part of the pipeline but the module that would
   * do it is not on main yet. It is reported MISSING and the run continues --
   * the stages downstream of it will block on the artifact it never wrote,
   * which is the truthful way for the gap to surface.
   */
  command: StageCommand | null;
  /** Why it is null. Required when it is. */
  missingBecause?: string;
  /**
   * D3, encoded. 'continue' is for a stage whose failure is a partial
   * outcome (one source down out of several). 'abort' is for a stage whose
   * failure invalidates everything after it (no database).
   */
  onFailure: 'abort' | 'continue';
}

/* ========================================================================== */
/* what happened                                                               */
/* ========================================================================== */

export type StageStatus =
  /** Ran, exit 0, produced what it promised. */
  | 'ok'
  /** Ran and failed, and D3 says the run carries on without it. */
  | 'down'
  /** Ran and failed, and the run cannot mean anything after it. */
  | 'failed'
  /** Did not run: a secret or an input file it needs is not there. */
  | 'blocked'
  /** Did not run: nobody has built it yet. */
  | 'missing'
  /** Did not run: an earlier stage aborted the run. */
  | 'skipped';

export interface StageResult {
  id: string;
  what: string;
  owner: string;
  status: StageStatus;
  /** Human detail. Never contains a credential value. */
  detail: string;
  ms: number;
}

export interface RunReport {
  startedAt: string;
  results: StageResult[];
  aborted: boolean;
}

/* ========================================================================== */
/* the one thing this runner must never do                                     */
/* ========================================================================== */

/**
 * DECISIONS D4/D13: posting a comment speaks publicly in Nikhil's name and is
 * strictly human-initiated. Nothing on a schedule may reach it. Asserted
 * structurally rather than left as a convention, because the convention is
 * one careless line away from being broken.
 */
export function assertNoCommentPath(stages: Stage[]): void {
  for (const stage of stages) {
    const argv = stage.command?.args ?? [];
    if (argv.some((a) => a.includes('finds/comment'))) {
      throw new Error(
        `Stage "${stage.id}" invokes finds/comment/**. The comment path posts ` +
          'publicly under Nikhil\'s name and is human-initiated only (D4/D13). ' +
          'It may never appear in a scheduled run.',
      );
    }
  }
}

/* ========================================================================== */
/* running one stage                                                           */
/* ========================================================================== */

function missingEnv(names: string[]): string[] {
  return names.filter((n) => !process.env[n]?.trim());
}

function runCommand(cmd: StageCommand): Promise<{ code: number | null; signal: string | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, cmd.args, { stdio: 'inherit' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, cmd.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, signal: err.message, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut });
    });
  });
}

async function runStage(stage: Stage): Promise<StageResult> {
  const base = { id: stage.id, what: stage.what, owner: stage.owner, ms: 0 };

  if (!stage.command) {
    return { ...base, status: 'missing', detail: stage.missingBecause ?? 'not implemented' };
  }

  const absent = missingEnv(stage.command.needsEnv ?? []);
  if (absent.length > 0) {
    return { ...base, status: 'blocked', detail: `unset: ${absent.join(', ')}` };
  }

  const absentFiles = (stage.command.needsFile ?? []).filter((f) => !existsSync(f));
  if (absentFiles.length > 0) {
    return { ...base, status: 'blocked', detail: `no input: ${absentFiles.join(', ')}` };
  }

  const startedAt = Date.now();
  const { code, signal, timedOut } = await runCommand(stage.command);
  const ms = Date.now() - startedAt;
  const failed: StageStatus = stage.onFailure === 'abort' ? 'failed' : 'down';

  if (timedOut) {
    return { ...base, ms, status: failed, detail: `timed out after ${stage.command.timeoutMs}ms` };
  }
  if (code !== 0) {
    return { ...base, ms, status: failed, detail: `exit ${code}${signal ? ` (${signal})` : ''}` };
  }

  const notProduced = (stage.command.produces ?? []).filter((f) => !existsSync(f));
  if (notProduced.length > 0) {
    return {
      ...base,
      ms,
      status: failed,
      detail: `exited 0 but did not write: ${notProduced.join(', ')}`,
    };
  }

  return { ...base, ms, status: 'ok', detail: `exit 0` };
}

/* ========================================================================== */
/* running the pipeline                                                        */
/* ========================================================================== */

export async function runPipeline(stages: Stage[]): Promise<RunReport> {
  assertNoCommentPath(stages);

  const results: StageResult[] = [];
  let aborted = false;

  for (const stage of stages) {
    if (aborted) {
      results.push({
        id: stage.id,
        what: stage.what,
        owner: stage.owner,
        status: 'skipped',
        detail: 'an earlier stage aborted the run',
        ms: 0,
      });
      continue;
    }

    console.log(`\n=== ${stage.id} — ${stage.what} (${stage.owner})`);
    const result = await runStage(stage);
    results.push(result);
    console.log(`--- ${stage.id}: ${result.status.toUpperCase()} — ${result.detail}`);

    // 'missing' never aborts: the pipeline map is worth printing in full, and
    // the stages after it block honestly on the input it never produced.
    if (stage.onFailure === 'abort' && (result.status === 'failed' || result.status === 'blocked')) {
      aborted = true;
    }
  }

  return { startedAt: new Date().toISOString(), results, aborted };
}

/* ========================================================================== */
/* the report                                                                  */
/* ========================================================================== */

export function formatReport(report: RunReport): string {
  const width = Math.max(...report.results.map((r) => r.id.length));
  const lines = report.results.map((r) => {
    const secs = r.ms > 0 ? ` ${(r.ms / 1000).toFixed(1)}s` : '';
    return `  ${r.id.padEnd(width)}  ${r.status.toUpperCase().padEnd(7)} ${r.detail}${secs}`;
  });
  return lines.join('\n');
}
