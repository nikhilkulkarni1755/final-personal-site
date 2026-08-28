/**
 * Run one crawl and print the evidence rows it produced.
 *
 *   node finds/verify/cli.ts <product-url> [candidate-id] [--persist]
 *
 * Prints by default. `--persist` writes to finds_evidence and requires a real
 * candidate id: an evidence row against a candidate that does not exist is
 * exactly the stub data D6 bans, and the foreign key would refuse it anyway.
 */

import { crawlCandidate } from './crawl.ts';
import { persistEvidence } from './persist.ts';

const args = process.argv.slice(2);
const persist = args.includes('--persist');
const [productUrl, candidateId] = args.filter((arg) => arg !== '--persist');

if (!productUrl) {
  console.error('usage: node finds/verify/cli.ts <product-url> [candidate-id] [--persist]');
  process.exit(2);
}
if (persist && !candidateId) {
  console.error('--persist needs a real candidate id from finds_candidates.');
  process.exit(2);
}

const result = await crawlCandidate({
  productUrl,
  candidateId: candidateId ?? '00000000-0000-0000-0000-000000000000',
});

if (!candidateId) {
  console.error('note: no candidate id given, so these rows are for reading, not for inserting.\n');
}

console.error(`crawl_run_id ${result.crawlRunId}`);
for (const decision of result.decisions) {
  console.error(`  ${decision.allowed ? 'ALLOW' : 'DENY '} ${decision.url}  ${decision.reason_code ?? '(no reason_code)'} -- ${decision.reason_detail}`);
}
console.error('');

if (persist) {
  const written = await persistEvidence(result.evidence);
  console.error(`wrote ${written.inserted} evidence row(s) for crawl_run_id ${written.crawlRunId}`);
} else {
  console.log(JSON.stringify(result.evidence, null, 2));
}
