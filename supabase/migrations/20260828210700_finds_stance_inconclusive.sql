-- ============================================================================
-- Interesting Finds: a citation may say "we looked and could not tell"
-- ============================================================================
-- finds_verdict_evidence.stance allowed only 'supports' and 'contradicts'.
-- W5's C1/C3/C4 score-1 outcomes cite evidence that settled NOTHING, and
-- neither existing value can describe that honestly:
--
--   'supports'    would claim the evidence backs a claim it does not touch.
--   'contradicts' would accuse a real company, on their own published page, of
--                 something the evidence does not show.
--
-- So W5 correctly refused to persist those verdicts rather than pick one. That
-- was the right refusal against the wrong constraint. "We looked and could not
-- tell" is a real and common finding -- it is precisely what score 1 ("no
-- evidence either way") means -- and the schema has to be able to say it.
--
-- This is also what keeps score 1 honest. Without 'inconclusive' the only way
-- to record a 1 is to mislabel its citations, which would make D7's audit trail
-- lie in exactly the cases where nothing was proven.
-- ============================================================================

ALTER TABLE finds_verdict_evidence
    DROP CONSTRAINT IF EXISTS finds_verdict_evidence_stance_check;
ALTER TABLE finds_verdict_evidence
    ADD CONSTRAINT finds_verdict_evidence_stance_check
    CHECK (stance IN ('supports', 'contradicts', 'inconclusive'));

COMMENT ON COLUMN finds_verdict_evidence.stance IS 'supports, contradicts, or inconclusive. A score of 0 cites contradicting evidence; a score of 1 cites evidence that settled nothing';
