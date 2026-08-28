// Migration 20260828210700 added 'inconclusive' to finds_verdict_evidence's
// stance CHECK. finds/score/persist.ts still refuses to persist any score that
// cites one, on the stated grounds that the column cannot store it.
import { partitionPersistable, buildVerdictWrite } from '../score/persist.ts';
const score = {
  criterion: 'C1', score: 1,
  rationale: 'unsubstantiated: we read the docs and they settled nothing',
  citations: [{ evidence_id: '11111111-1111-4111-8111-111111111111', stance: 'inconclusive' }],
};
const { persistable, blocked } = partitionPersistable([score]);
console.log('partitionPersistable([C1 score 1, one inconclusive citation])');
console.log('  persistable:', persistable.length);
console.log('  blocked    :', blocked.length, blocked[0] ? `-- "${blocked[0].reason}"` : '');
try { buildVerdictWrite('a'.repeat(8)+'-aaaa-4aaa-8aaa-'+'a'.repeat(12), 'b'.repeat(8)+'-bbbb-4bbb-8bbb-'+'b'.repeat(12), [score]); console.log('  buildVerdictWrite: accepted'); }
catch (e) { console.log('  buildVerdictWrite: THREW --', e.message.split('.')[0]); }
