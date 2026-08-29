/**
 * The lane's CLI. Two verbs, both read-only about the world:
 *
 *   node finds/score/run.ts score [--dry-run]            score every crawled candidate
 *   node finds/score/run.ts select [DATE] [OUT.json]     pick the day's digest
 *
 * `select` writes NOTHING. The digest tables are W6's, and W6 selects from
 * `finds_undigested_candidates` for exactly the reason this prints instead:
 * a selection is not a send, and only a send may consume a candidate.
 *
 * With an output path, `select` writes W6's DigestSelection there -- the handoff
 * W10's daily runner passes to finds/email/send.ts, carrying the render input
 * and the real candidate ids send.ts needs for finds_digest_items. Nothing else
 * writes that file, and it is NOT written on a day with no picks: an empty day
 * must not become an empty digest.
 *
 * `--dry-run` scores and reports and WRITES NOTHING -- no verdicts, no status
 * changes. It exists because the first run against a real database should be a
 * look, not a write: evidence is append-only and a verdict is not, so a bad
 * write is recoverable, but reading the distribution first is free and tells us
 * whether the rubric is behaving before it leaves a record.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (D17). Absent, W2's
 * getSupabaseClient() fails loud and this exits non-zero rather than
 * pretending it scored nothing (D6).
 */

import { writeFileSync } from 'node:fs';
import { buildVerdictWrite } from './persist.ts';
import { candidatesToScore, getSupabaseClient, latestGeneration, loadGeneration, loadSelectionCandidates, markStatus, refusedUrlCount, writeVerdicts } from './db.ts';
import { scoreCandidate } from './score.ts';
import { selectForDay } from './select.ts';
import { toDigestSelection } from './digest.ts';

async function score(dryRun: boolean): Promise<number> {
  const db = getSupabaseClient();
  const candidates = await candidatesToScore(db);
  if (candidates.length === 0) {
    console.log('Nothing to score: no candidate is in status "crawled".');
    return 0;
  }
  if (dryRun) console.log('DRY RUN: scoring and reporting only. Nothing will be written.\n');

  let scored = 0;
  let unscoreable = 0;
  // Why this tally: C1 is the criterion Nikhil put first, and if nearly
  // everything lands on `unsubstantiated` the digest reads as a list of
  // shrugs. That is a rubric problem worth seeing on the first run rather
  // than after his first email.
  const c1Status = new Map<string, number>();
  const notScored = new Map<string, number>();

  for (const candidate of candidates) {
    const crawlRunId = await latestGeneration(db, candidate.id);
    const outcome = scoreCandidate({
      candidate_id: candidate.id,
      candidate_status: candidate.status,
      evidence_run_id: crawlRunId ?? '',
      rows: crawlRunId ? await loadGeneration(db, candidate.id, crawlRunId) : [],
      urls_refused: await refusedUrlCount(db, candidate.id),
    });

    if (outcome.kind === 'unscoreable') {
      unscoreable += 1;
      notScored.set(outcome.reason, (notScored.get(outcome.reason) ?? 0) + 1);
      console.log(`  ${candidate.id}  NOT SCORED (${outcome.reason}): ${outcome.detail}`);
      continue;
    }

    const c1 = outcome.scores.find((s) => s.criterion === 'C1');
    if (c1?.status) c1Status.set(c1.status, (c1Status.get(c1.status) ?? 0) + 1);

    if (!dryRun) {
      await writeVerdicts(db, buildVerdictWrite(candidate.id, outcome.evidence_run_id, outcome.scores));
      await markStatus(db, candidate.id, 'scored');
    }
    scored += 1;
    console.log(
      `  ${candidate.id}  ${outcome.scores.map((s) => `${s.criterion}=${s.score}`).join(' ')}` +
        `  (${outcome.scores.reduce((n, s) => n + s.citations.length, 0)} citations)` +
        (c1?.status ? `  C1 ${c1.status}` : ''),
    );
  }

  const tally = (m: Map<string, number>) =>
    [...m.entries()].sort().map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
  console.log(
    `\n${candidates.length} candidate(s): ${scored} scored${dryRun ? ' (nothing written)' : ''}, ` +
      `${unscoreable} not scoreable.`,
  );
  console.log(`  not scored by reason: ${tally(notScored)}`);
  console.log(`  C1 by status:         ${tally(c1Status)}`);
  return 0;
}

async function select(date: string, outputPath?: string): Promise<number> {
  const selection = selectForDay(date, await loadSelectionCandidates(getSupabaseClient()));
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
  // The handoff to the send. Written ONLY when something was selected: an
  // empty day must not become an empty digest, and W10's stage reports the
  // absent file rather than W6 mailing nothing.
  if (outputPath) {
    const handoff = toDigestSelection(selection);
    if (handoff === null) {
      console.log(`\nNo digest written to ${outputPath}: nothing was selected.`);
    } else {
      writeFileSync(outputPath, `${JSON.stringify(handoff, null, 2)}\n`);
      console.log(`\nDigest selection written to ${outputPath} (${handoff.digest.finds.length} find(s)).`);
    }
  }
  return 0;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [verb, argument, outputPath] = args.filter((a) => a !== '--dry-run');
const today = new Date().toISOString().slice(0, 10);

if (verb !== 'score' && verb !== 'select') {
  console.error(
    'usage: node finds/score/run.ts score [--dry-run] | select [YYYY-MM-DD] [digest-input.json]',
  );
  process.exit(2);
}

process.exitCode = verb === 'score' ? await score(dryRun) : await select(argument ?? today, outputPath);
