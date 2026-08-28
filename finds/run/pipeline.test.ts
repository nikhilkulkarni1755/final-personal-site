/**
 * The runner's failure policy, proven.
 *
 * This is the part of the lane that decides what a failing stage MEANS, and
 * it is worth testing on its own precisely because it must keep behaving
 * correctly when the datastore, the sources and the credentials are all
 * absent -- which is the normal state of an unattended job that has just
 * broken.
 *
 * Every stage below is a real subprocess with a real exit code, not a mock:
 * the runner spawns `node -e ...`. What is constructed inline is a stage
 * definition, never a launch, a verdict or a digest -- D6 bans fabricated
 * pipeline DATA, and explicitly allows a test that builds a shape inline and
 * throws it away.
 *
 * Run: node --test finds/run/pipeline.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoCommentPath, runPipeline } from './pipeline.ts';
import type { Stage } from './pipeline.ts';

const EXIT_OK = ['-e', 'process.exit(0)'];
const EXIT_FAIL = ['-e', 'process.exit(1)'];

function stage(id: string, over: Partial<Stage> = {}): Stage {
  return {
    id,
    what: id,
    owner: 'test',
    command: { args: EXIT_OK, timeoutMs: 10_000 },
    onFailure: 'continue',
    ...over,
  };
}

function statuses(results: { id: string; status: string }[]): Record<string, string> {
  return Object.fromEntries(results.map((r) => [r.id, r.status]));
}

test('D3: a source failing does NOT stop the run', async () => {
  const report = await runPipeline([
    stage('preflight'),
    stage('source', { command: { args: EXIT_FAIL, timeoutMs: 10_000 }, onFailure: 'continue' }),
    stage('after'),
  ]);
  assert.deepEqual(statuses(report.results), { preflight: 'ok', source: 'down', after: 'ok' });
  assert.equal(report.aborted, false);
});

test('a datastore failing DOES stop the run, and later stages say so', async () => {
  const report = await runPipeline([
    stage('preflight', { command: { args: EXIT_FAIL, timeoutMs: 10_000 }, onFailure: 'abort' }),
    stage('source'),
    stage('digest'),
  ]);
  assert.deepEqual(statuses(report.results), { preflight: 'failed', source: 'skipped', digest: 'skipped' });
  assert.equal(report.aborted, true);
});

test('a missing env var blocks the stage and names it -- without printing its value', async () => {
  process.env.W10_TEST_SECRET = 'super-secret-value-that-must-never-be-logged';
  const report = await runPipeline([
    stage('needs', { command: { args: EXIT_OK, timeoutMs: 10_000, needsEnv: ['W10_TEST_ABSENT'] } }),
    stage('has', { command: { args: EXIT_OK, timeoutMs: 10_000, needsEnv: ['W10_TEST_SECRET'] } }),
  ]);
  const [needs, has] = report.results;
  assert.equal(needs.status, 'blocked');
  assert.match(needs.detail, /W10_TEST_ABSENT/);
  assert.equal(has.status, 'ok');
  const everything = JSON.stringify(report);
  assert.equal(everything.includes('super-secret-value-that-must-never-be-logged'), false);
  delete process.env.W10_TEST_SECRET;
});

test('D17: an "A|B" requirement is satisfied by either name', async () => {
  process.env.W10_TEST_FALLBACK = 'https://example.invalid';
  const report = await runPipeline([
    stage('either', {
      command: { args: EXIT_OK, timeoutMs: 10_000, needsEnv: ['W10_TEST_PRIMARY|W10_TEST_FALLBACK'] },
    }),
    stage('neither', {
      command: { args: EXIT_OK, timeoutMs: 10_000, needsEnv: ['W10_TEST_PRIMARY|W10_TEST_ALSO_ABSENT'] },
    }),
  ]);
  assert.equal(report.results[0].status, 'ok');
  assert.equal(report.results[1].status, 'blocked');
  assert.match(report.results[1].detail, /W10_TEST_PRIMARY or W10_TEST_ALSO_ABSENT/);
  delete process.env.W10_TEST_FALLBACK;
});

test('a stage whose input was never produced is blocked, not run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'w10-test-'));
  const report = await runPipeline([
    stage('digest', { command: { args: EXIT_OK, timeoutMs: 10_000, needsFile: [join(dir, 'absent.json')] } }),
  ]);
  assert.equal(report.results[0].status, 'blocked');
  assert.match(report.results[0].detail, /no input/);
});

test('NO FAKE GREEN: exiting 0 without producing the promised artifact is a failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'w10-test-'));
  const promised = join(dir, 'digest-input.json');
  const report = await runPipeline([
    stage('liar', {
      command: { args: EXIT_OK, timeoutMs: 10_000, produces: [promised] },
      onFailure: 'abort',
    }),
  ]);
  assert.equal(report.results[0].status, 'failed');
  assert.match(report.results[0].detail, /exited 0 but did not write/);

  writeFileSync(promised, '{}');
  const honest = await runPipeline([
    stage('honest', { command: { args: EXIT_OK, timeoutMs: 10_000, produces: [promised] } }),
  ]);
  assert.equal(honest.results[0].status, 'ok');
});

test('an unbuilt stage reports MISSING and never aborts the run', async () => {
  const report = await runPipeline([
    stage('verify', { command: null, missingBecause: 'not on main yet' }),
    stage('after'),
  ]);
  assert.deepEqual(statuses(report.results), { verify: 'missing', after: 'ok' });
  assert.equal(report.aborted, false);
});

test('a hung stage is killed and reported, not waited on forever', async () => {
  const report = await runPipeline([
    stage('hang', { command: { args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 500 } }),
  ]);
  assert.equal(report.results[0].status, 'down');
  assert.match(report.results[0].detail, /timed out/);
});

test('D4/D13: the comment path cannot be scheduled', () => {
  assert.throws(
    () => assertNoCommentPath([stage('oops', { command: { args: ['finds/comment/postComment.ts'], timeoutMs: 1 } })]),
    /human-initiated only/,
  );
  assert.doesNotThrow(() => assertNoCommentPath([stage('fine')]));
});
