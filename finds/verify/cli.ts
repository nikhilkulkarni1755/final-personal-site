/**
 * Run one crawl and print the evidence rows it would write.
 *
 *   node finds/verify/cli.ts <product-url> [candidate-id]
 *
 * Prints, it does not persist -- persisting needs a real candidate row and the
 * service-role credential. Without a candidate id it uses the nil UUID and says
 * so, because an evidence row invented against a candidate that does not exist
 * is exactly the stub data D6 bans.
 */

import { crawlCandidate } from './crawl.ts';

const [productUrl, candidateId] = process.argv.slice(2);

if (!productUrl) {
  console.error('usage: node finds/verify/cli.ts <product-url> [candidate-id]');
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

console.log(JSON.stringify(result.evidence, null, 2));
