/**
 * The lane's CLI. Two verbs, both read-only about the world:
 *
 *   node finds/score/run.ts score           score every crawled candidate
 *   node finds/score/run.ts select [DATE]   pick the day's digest, print it
 *
 * `select` writes NOTHING. The digest tables are W6's, and W6 selects from
 * `finds_undigested_candidates` for exactly the reason this prints instead:
 * a selection is not a send, and only a send may consume a candidate.
 *
 * Needs DATABASE_URL. Absent, W2's getPool() fails loud and this exits
 * non-zero rather than pretending it scored nothing (D6).
 */

import { buildVerdictWrite, partitionPersistable } from './persist.ts';
import { candidatesToScore, getPool, latestGeneration, loadGeneration, loadSelectionCandidates, markStatus, refusedUrlCount, runPlan } from './db.ts';
import { scoreCandidate } from './score.ts';
import { selectForDay } from './select.ts';

async function score(): Promise<number> {
  const pool = getPool();
  const candidates = await candidatesToScore(pool);
  if (candidates.length === 0) {
    console.log('Nothing to score: no candidate is in status "crawled".');
    return 0;
  }

  let scored = 0;
  let unscoreable = 0;
  let blockedVerdicts = 0;

  for (const candidate of candidates) {
    const crawlRunId = await latestGeneration(pool, candidate.id);
    const outcome = scoreCandidate({
      candidate_id: candidate.id,
      candidate_status: candidate.status,
      evidence_run_id: crawlRunId ?? '',
      rows: crawlRunId ? await loadGeneration(pool, candidate.id, crawlRunId) : [],
      urls_refused: await refusedUrlCount(pool, candidate.id),
    });

    if (outcome.kind === 'unscoreable') {
      unscoreable += 1;
      console.log(`  ${candidate.id}  NOT SCORED (${outcome.reason}): ${outcome.detail}`);
      continue;
    }

    const { persistable, blocked } = partitionPersistable(outcome.scores);
    for (const { reason } of blocked) {
      blockedVerdicts += 1;
      console.log(`  ${candidate.id}  NOT PERSISTED: ${reason}`);
    }
    if (persistable.length > 0) {
      await runPlan(pool, buildVerdictWrite(candidate.id, outcome.evidence_run_id, persistable));
      await markStatus(pool, candidate.id, 'scored');
      scored += 1;
      console.log(
        `  ${candidate.id}  ${persistable.map((s) => `${s.criterion}=${s.score}`).join(' ')}` +
          `  (${persistable.reduce((n, s) => n + s.citations.length, 0)} citations)`,
      );
    }
  }

  console.log(
    `\n${candidates.length} candidate(s): ${scored} scored, ${unscoreable} not scoreable, ` +
      `${blockedVerdicts} verdict(s) withheld pending the 'inconclusive' stance value.`,
  );
  return 0;
}

async function select(date: string): Promise<number> {
  const selection = selectForDay(date, await loadSelectionCandidates(getPool()));
  console.log(selection.summary);
  for (const pick of selection.picks) {
    console.log(`\n  ${pick.name}  ${pick.product_url}`);
    console.log(`    ${pick.why}`);
    console.log(`    sources: ${pick.source_slugs.join(', ') || 'none recorded'}`);
  }
  // Always printed, not only on an empty day. On a Monday this is 280 lines,
  // and a selector whose rejections are invisible is one nobody can argue with.
  if (selection.rejected.length > 0) {
    console.log(`\nNot selected (${selection.rejected.length}), first ${Math.min(20, selection.rejected.length)}:`);
    for (const rejection of selection.rejected.slice(0, 20)) {
      console.log(`  ${rejection.name}: ${rejection.reason} -- ${rejection.detail}`);
    }
  }
  return 0;
}

const [verb, argument] = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);

if (verb !== 'score' && verb !== 'select') {
  console.error('usage: node finds/score/run.ts score | select [YYYY-MM-DD]');
  process.exit(2);
}

try {
  process.exitCode = verb === 'score' ? await score() : await select(argument ?? today);
} finally {
  await getPool().end();
}
