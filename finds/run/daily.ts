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

  // --- ingest. Four independent sources; D3 says one dying is a partial
  // outcome, not a run-ending one, so every one of these is 'continue'.
  // Each connector has already persisted its own failure to finds_sources by
  // the time it exits non-zero, so a DOWN is durable, not just a log line.
  // Ordered by R1's measured yield: Uneed is the completest daily record,
  // Show HN the highest volume.
  {
    id: 'ingest:uneed',
    what: 'pull today\'s Uneed launches (no credential, >=50/day)',
    owner: 'W2',
    command: { args: ['finds/sources/run-uneed.ts'], timeoutMs: 10 * 60_000, needsEnv: DB_ENV },
    onFailure: 'continue',
  },
  {
    id: 'ingest:hn',
    what: 'pull today\'s Show HN launches (no credential, ~134/day)',
    owner: 'W2',
    command: { args: ['finds/sources/run-hn.ts'], timeoutMs: 10 * 60_000, needsEnv: DB_ENV },
    onFailure: 'continue',
  },
  {
    id: 'ingest:github',
    what: 'pull newly published GitHub projects',
    owner: 'W2',
    command: {
      args: ['finds/sources/run-github.ts'],
      timeoutMs: 10 * 60_000,
      // Its own hard requirement -- reported BLOCKED here rather than left to
      // crash inside the connector, so the summary says which secret is
      // missing instead of showing a stack trace.
      needsEnv: [...DB_ENV, 'GITHUB_TOKEN'],
    },
    onFailure: 'continue',
  },
  {
    id: 'ingest:peerlist',
    what: 'pull the Peerlist launch listing (headless Chromium, no credential)',
    owner: 'W2',
    // Run daily even though Peerlist is a Monday drop of ~286 (D10): the
    // week's launches stay listed all week and the sighting upsert is
    // idempotent, so a daily run costs one browser session and silently
    // repairs a Monday the cron missed. A Monday-only schedule would lose
    // the whole week to one bad run.
    command: { args: ['finds/sources/run-peerlist.ts'], timeoutMs: 15 * 60_000, needsEnv: DB_ENV },
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
    // W4's crawler HAS merged, and its gate wiring is right -- but
    // finds/verify/cli.ts takes ONE product URL and an optional candidate id.
    // A daily run needs an entry point that selects the day's new candidates
    // and crawls each through the gate, honouring the per-authority delay and
    // wall-clock budgets in GATE_CONFIG. Composing that here would mean
    // writing W4's batch logic inside W10, which is exactly the lane-boundary
    // violation this pipeline avoids. RAISED WITH THE COORDINATOR.
    missingBecause:
      'finds/verify/ has merged, but only as a single-URL CLI (cli.ts <product-url> ' +
      '[candidate-id] [--persist]). A daily stage needs a batch entry point that ' +
      'selects new candidates and crawls each through the gate. Asked W4 for one.',
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
