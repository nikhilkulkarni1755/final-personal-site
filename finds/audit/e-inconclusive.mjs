// Regression check. finds/score/persist.ts once refused any score citing a
// stance:'inconclusive' row on the grounds that finds_verdict_evidence could
// not store one -- after migration 20260828210700 had added it to the CHECK.
// This asserts the refusal is gone and the stance goes through.
import { buildVerdictWrite } from '../score/persist.ts';
const CID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const score = {
  criterion: 'C1', score: 1,
  rationale: 'unsubstantiated: we read the docs and they settled nothing',
  citations: [{ evidence_id: '11111111-1111-4111-8111-111111111111', stance: 'inconclusive' }],
};
const args = buildVerdictWrite(CID, RUN, [score]);
const stances = args.p_verdicts.flatMap((v) => v.citations.map((c) => c.stance));
console.log('buildVerdictWrite with one inconclusive citation:');
console.log('  accepted, stances sent to finds_write_verdict:', JSON.stringify(stances));
console.log('  (finds/db/schema.test.sql:479,546 insert this stance and test-schema.sh passes)');
if (!stances.includes('inconclusive')) { console.error('REGRESSION: the stance was dropped or rewritten'); process.exit(1); }
