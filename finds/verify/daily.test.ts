/**
 * The batch runner's failure policy, proven with a real subprocess.
 *
 * There is no local PostgREST to point at, so this cannot prove a green run --
 * and a harness that faked one would prove nothing (the lesson W10 wrote up
 * when it deleted prove-daily.sh). What it CAN prove without a credential is
 * the half that matters most: an absent credential is a loud stop and never a
 * quiet skip, and the stage refuses to look like it succeeded.
 */

import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function runDaily(env: Record<string, string | undefined>) {
  try {
    const { stdout, stderr } = await run('node', ['finds/verify/daily.ts'], {
      env: { ...process.env, SUPABASE_URL: '', VITE_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('the verify stage without a credential', () => {
  it('exits non-zero and names the variable, rather than reporting an empty queue', async () => {
    const { code, stdout, stderr } = await runDaily({});
    assert.notEqual(code, 0, 'a missing credential must not look like a clean run');
    assert.match(stderr, /SUPABASE_URL/);
    assert.match(stderr, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(stdout, /no candidates/, 'an unreachable datastore is not "nothing to crawl"');
  });

  it('does not crawl anything before it has somewhere to put the results', async () => {
    const { stdout } = await runDaily({});
    assert.doesNotMatch(stdout, /candidate\(s\) queued/);
    assert.doesNotMatch(stdout, /-> crawled/);
  });
});
