-- ============================================================================
-- Interesting Finds: verdicts record which rubric produced them
-- ============================================================================
-- finds_crawl_verdicts has carried rubric_version since it was created, on the
-- reasoning that a verdict is only interpretable against the revision of the
-- rules that decided it. The same argument applies to C1-C4 scores and was
-- missed: R2's rubric will reach v1.2, the scoring rubric will move with it,
-- and a bare 0-3 with no version attached stops being readable the moment the
-- rules change underneath it.
--
-- W5 has been riding the version inside `scored_by` as a stopgap. That column
-- means "which model, or a human", and overloading it makes both facts harder
-- to query and impossible to constrain.
--
-- NOT NULL with no default, deliberately. A default would silently stamp a
-- version onto scores it did not produce, which is the specific dishonesty this
-- column exists to prevent. That makes this migration fail loudly if any
-- verdict row already exists -- which is the correct outcome, because a human
-- would then have to say which rubric scored it. In practice the table is
-- provably empty: D7's deferred trigger has aborted every write attempt made
-- over PostgREST, which is the whole reason the RPC in the next migration
-- exists.
-- ============================================================================

ALTER TABLE finds_verdicts
    ADD COLUMN IF NOT EXISTS rubric_version TEXT NOT NULL;

ALTER TABLE finds_verdicts
    DROP CONSTRAINT IF EXISTS finds_verdicts_rubric_version_check;
ALTER TABLE finds_verdicts
    ADD CONSTRAINT finds_verdicts_rubric_version_check
    CHECK (btrim(rubric_version) <> '');

COMMENT ON COLUMN finds_verdicts.rubric_version IS 'The scoring rubric revision that produced this score. A bare 0-3 is unreadable once the rules move; scored_by says which model, this says under which rules';

-- The unique key is deliberately unchanged: (candidate_id, evidence_run_id,
-- criterion). Re-scoring the same evidence under a new rubric UPDATES the
-- verdict and its rubric_version rather than accumulating one row per revision.
-- That matches the existing design -- verdicts are recomputed against evidence,
-- and exactly one verdict per criterion is current. If the initiative later
-- wants to keep superseded scores for comparison, that is a real change with a
-- real cost (every reader must then choose a revision) and should be decided
-- deliberately rather than fall out of this column.
