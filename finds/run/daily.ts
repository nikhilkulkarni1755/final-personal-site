/**
 * The daily run. This is the thing Nikhil actually asked for -- "emails
 * everyday with new launches" -- expressed as an ordered list of stages and,
 * more importantly, a policy for what each stage's failure means.
 *
 * Composition only. Every stage below invokes a module another lane owns,
 * through the entry point that lane registered. This file adds no pipeline
 * logic of its own; if a stage needs to behave differently, that is a change
 * in the owning lane, not here (finds-coord DEPENDENCIES.md file ownership).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the run exits 0 only if a digest was
 * actually sent. Partial success is the normal case in a pipeline with four
 * external sources and a crawler, and every stage reports its own outcome --
 * but "some of it worked" is not the product. A green run that mailed
 * nothing would let Nikhil conclude the system is fine while it silently
 * sends him nothing, which is the single worst failure available to us
 * (DECISIONS D6). So today, with the crawler and the selection step not yet
 * on main, this run is RED, and it says exactly which stage stopped it.
 *
 * Usage: node finds/run/daily.ts
 *   env  SUPABASE_URL                required (falls back to VITE_SUPABASE_URL)
 *        SUPABASE_SERVICE_ROLE_KEY   required -- D17. Never VITE_-prefixed.
 *        GITHUB_TOKEN                required by the GitHub connector only
 *        GMAIL_USER                  required for the send (D2)
 *        GMAIL_APP_PASSWORD          required for the send (D2)
 *        FINDS_RUN_DATE         override the run's date (default: today, UTC)
 *        FINDS_RUN_DIR          override where stage artifacts go
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatReport, runPipeline } from './pipeline.ts';
import type { Stage } from './pipeline.ts';

const RUN_DATE = process.env.FINDS_RUN_DATE?.trim() || new Date().toISOString().slice(0, 10);
const RUN_DIR = process.env.FINDS_RUN_DIR?.trim() || join('finds', 'run', '.runs', RUN_DATE);
mkdirSync(RUN_DIR, { recursive: true });

/**
 * The handoff between selection and the send: W5 writes the day's chosen
 * 2-3 finds here as a DigestInput, W6's send.ts reads exactly that file.
 * Nothing else writes it. If it is absent, no digest is sent -- there is no
 * fallback content, because a fallback would be invented data (D6).
 */
const DIGEST_INPUT = join(RUN_DIR, 'digest-input.json');

/**
 * D17, and D19 which corrected this file: every stage that touches the
 * datastore goes through finds/sources/db.ts's service-role client. There is
 * no second database credential. SUPABASE_URL falls back to
 * VITE_SUPABASE_URL (the URL is public); the KEY never carries a VITE_
 * prefix, because Vite would bundle a full RLS bypass into the browser.
 */
const DB_ENV = ['SUPABASE_URL|VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

const STAGES: Stage[] = [
  {
    id: 'preflight',
    what: 'prove Supabase is reachable and migrated, and print per-source health',
    owner: 'W10 (composing W2 db + W3 schema)',
    command: { args: ['finds/run/preflight.ts'], timeoutMs: 60_000, needsEnv: DB_ENV },
    // A datastore that is not there invalidates every stage after it, and --
    // just as important -- it would make every connector fail at once and
    // look like four dead sources. Abort, so D3 stays meaningful.
    onFailure: 'abort',
  },

  // D3: a source being unreachable is reported DOWN and the run carries on.
  // run-hn.ts has already written the failure to finds_sources by the time it
  // exits non-zero, so the DOWN state is durable, not just a log line.
  {
    id: 'ingest:hn',
    what: 'pull today\'s Show HN launches (no credential, ~134/day)',
    owner: 'W2',
    command: { args: ['finds/sources/run-hn.ts'], timeoutMs: 10 * 60_000, needsEnv: DB_ENV },
    onFailure: 'continue',
  },

  {
    id: 'census',
    what: 'count what actually landed, and fail loudly on an empty day',
    owner: 'W10',
    command: { args: ['finds/run/census.ts'], timeoutMs: 5 * 60_000, needsEnv: DB_ENV },
    onFailure: 'continue',
  },
  {
    id: 'verify',
    what: 'crawl each new candidate through the permission gate and record evidence',
    owner: 'W4 (through W1\'s gate)',
    command: null,
    missingBecause:
      'finds/verify/** is not wired into the daily run yet.',
    onFailure: 'continue',
  },
  {
    id: 'select',
    what: 'score C1-C4 against the evidence and choose the day\'s 2-3 finds',
    owner: 'W5',
    command: null,
    missingBecause:
      'W5 has shipped C1 and the D7-enforcing write path, but not the selection ' +
      'step and not a CLI that writes ' + DIGEST_INPUT + '. That file is the ' +
      'handoff to the send, and nothing else may write it.',
    onFailure: 'continue',
  },
  {
    id: 'digest',
    what: 'mail Nikhil the day\'s digest',
    owner: 'W6',
    command: {
      args: ['finds/email/send.ts', DIGEST_INPUT],
      timeoutMs: 5 * 60_000,
      // D2: absent credential is a loud stop, never a skip and never a
      // pretend-send. Names only -- no value is read or printed here.
      needsEnv: ['GMAIL_USER', 'GMAIL_APP_PASSWORD'],
      needsFile: [DIGEST_INPUT],
    },
    onFailure: 'abort',
  },
];

const report = await runPipeline(STAGES);

console.log(`\n================ daily run ${RUN_DATE} ================`);
console.log(formatReport(report));

const digest = report.results.find((r) => r.id === 'digest');
const sent = digest?.status === 'ok';

if (sent) {
  console.log('\nRUN OK — the digest was sent.');
} else {
  const stoppers = report.results.filter((r) => r.status !== 'ok' && r.status !== 'skipped');
  console.log('\nRUN FAILED — NO DIGEST WAS SENT. Nikhil received nothing today.');
  console.log('Stages that did not succeed:');
  for (const r of stoppers) {
    console.log(`  ${r.id} [${r.owner}] ${r.status.toUpperCase()}: ${r.detail}`);
  }
  console.log(
    '\nThis exit code is the honest one. A run that ingests launches but mails\n' +
      'nothing is not the product, and reporting it green would be worse than\n' +
      'reporting nothing at all (DECISIONS D6).',
  );
  process.exitCode = 1;
}
