-- ============================================================================
-- Interesting Finds: a citation must come from the generation it scored
-- ============================================================================
-- finds_verdicts.evidence_run_id says which crawl generation a score was
-- computed from. Until now nothing checked that its citations actually came
-- from that generation. The composite FKs guaranteed same-CANDIDATE but not
-- same-RUN, so a verdict could claim to score generation A while pointing at
-- evidence from generation B -- and because evidence is append-only, several
-- generations of the same page sit in the table waiting to be mixed up.
--
-- That matters more than it sounds. Evidence is immutable specifically so a
-- score's justification cannot move underneath it; citing across generations
-- reintroduces exactly the drift immutability was buying, one indirection out.
-- A re-crawl that fixed a 404 would let a stale score keep citing the 404.
--
-- Deliberately NOT landed in 20260828210900, whose job was to UNBLOCK W5's
-- write path. Adding a new blocking constraint inside the migration that
-- unblocks a lane is how a fix becomes the next outage. W5 has since confirmed
-- citations never span runs -- and by construction rather than by discipline:
-- scoreCandidate() narrows to one generation before any criterion sees a row,
-- and loadGeneration() filters on crawl_run_id independently. Two layers,
-- either sufficient, plus three regression locks. So the constraint records a
-- property the code already has instead of imposing a new one.
--
-- MECHANISM: the same composite-FK trick already used for same-candidate,
-- widened by one column. Not a trigger -- a trigger can be disabled, deferred
-- or bypassed by the service role, whereas a foreign key cannot.
-- ============================================================================

-- ============================================================================
-- Release the foreign keys first
-- ============================================================================
-- Dropped up front, before their target unique constraints are touched. On a
-- re-run the new FKs already exist and depend on those targets, so recreating a
-- target while a key still points at it fails. Order, not CASCADE: CASCADE here
-- would silently drop whatever else had come to depend on them.
-- ============================================================================

ALTER TABLE finds_verdict_evidence
    DROP CONSTRAINT IF EXISTS finds_verdict_evidence_verdict_fkey;
ALTER TABLE finds_verdict_evidence
    DROP CONSTRAINT IF EXISTS finds_verdict_evidence_evidence_fkey;

-- ============================================================================
-- Widen the FK targets
-- ============================================================================
-- `id` is already the primary key of both tables, so these UNIQUE constraints
-- add no new uniqueness. They exist only to be referenced -- Postgres requires
-- a FK's target columns to carry a unique constraint.
-- ============================================================================

ALTER TABLE finds_evidence
    DROP CONSTRAINT IF EXISTS finds_evidence_id_candidate_run_key;
ALTER TABLE finds_evidence
    ADD CONSTRAINT finds_evidence_id_candidate_run_key
    UNIQUE (id, candidate_id, crawl_run_id);

ALTER TABLE finds_verdicts
    DROP CONSTRAINT IF EXISTS finds_verdicts_id_candidate_run_key;
ALTER TABLE finds_verdicts
    ADD CONSTRAINT finds_verdicts_id_candidate_run_key
    UNIQUE (id, candidate_id, evidence_run_id);

-- ============================================================================
-- Carry the run on the citation
-- ============================================================================
-- Redundant for the same reason candidate_id is redundant here, and for the
-- same payoff: it is what lets the foreign keys be composite.
--
-- Backfilled from the verdict rather than defaulted, because there IS a correct
-- answer -- the verdict already knows which generation it scored. (Contrast
-- rubric_version in 20260828210800, which had no correct historical value and
-- so was added NOT NULL with no default on purpose.)
--
-- If any existing citation genuinely crosses generations, the backfill will
-- give it the verdict's run and the foreign key below will then REFUSE it, and
-- this migration fails loudly. That is the intended behaviour: a pre-existing
-- violation should surface here, not be quietly grandfathered in.
-- ============================================================================

ALTER TABLE finds_verdict_evidence
    ADD COLUMN IF NOT EXISTS evidence_run_id UUID;

UPDATE finds_verdict_evidence ve
   SET evidence_run_id = v.evidence_run_id
  FROM finds_verdicts v
 WHERE v.id = ve.verdict_id
   AND ve.evidence_run_id IS NULL;

ALTER TABLE finds_verdict_evidence
    ALTER COLUMN evidence_run_id SET NOT NULL;

COMMENT ON COLUMN finds_verdict_evidence.evidence_run_id IS 'The crawl generation this citation belongs to. Redundant by design: it is what lets both foreign keys pin the run as well as the candidate';

-- ============================================================================
-- Re-add the foreign keys, now three columns wide
-- ============================================================================
-- The new keys strictly imply the old ones -- candidate_id is still in both --
-- so keeping the old pair would leave two constraints expressing one rule, and
-- the weaker one would be the misleading half of the pair. Dropped rather than
-- left to drift.
-- ============================================================================

ALTER TABLE finds_verdict_evidence
    ADD CONSTRAINT finds_verdict_evidence_verdict_fkey
    FOREIGN KEY (verdict_id, candidate_id, evidence_run_id)
    REFERENCES finds_verdicts(id, candidate_id, evidence_run_id) ON DELETE CASCADE;

-- RESTRICT, unchanged: evidence is append-only and a cited row must stay
-- reachable.
ALTER TABLE finds_verdict_evidence
    ADD CONSTRAINT finds_verdict_evidence_evidence_fkey
    FOREIGN KEY (evidence_id, candidate_id, evidence_run_id)
    REFERENCES finds_evidence(id, candidate_id, crawl_run_id) ON DELETE RESTRICT;

-- Now genuinely redundant: nothing references the two-column targets any more.
ALTER TABLE finds_evidence DROP CONSTRAINT IF EXISTS finds_evidence_id_candidate_key;
ALTER TABLE finds_verdicts DROP CONSTRAINT IF EXISTS finds_verdicts_id_candidate_key;

-- ============================================================================
-- Teach the RPC to supply it
-- ============================================================================
-- finds_write_verdict writes the citations, so it has to populate the new
-- column or every write fails. It already takes the run as an argument and
-- writes the verdict with it, so the citation takes the same value -- which is
-- what makes the foreign key meaningful: the evidence row must really belong to
-- the generation the caller says it scored.
--
-- Replaced in full rather than patched, so the function text in the database is
-- never a merge of two migrations.
-- ============================================================================

CREATE OR REPLACE FUNCTION finds_write_verdict(
    p_candidate_id    UUID,
    p_evidence_run_id UUID,
    p_rubric_version  TEXT,
    p_verdicts        JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v        JSONB;
    v_id     UUID;
    written  INTEGER := 0;
BEGIN
    IF jsonb_typeof(p_verdicts) <> 'array' OR jsonb_array_length(p_verdicts) = 0 THEN
        RAISE EXCEPTION 'finds_write_verdict: no verdicts supplied'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- The delete-then-insert below leaves a verdict briefly uncited, which is
    -- legal only while D7's check is deferred. Do not rely on the caller's
    -- transaction being in that state; put it there.
    SET CONSTRAINTS trigger_finds_verdicts_require_evidence,
                    trigger_finds_verdict_evidence_require_evidence DEFERRED;

    IF p_rubric_version IS NULL OR btrim(p_rubric_version) = '' THEN
        RAISE EXCEPTION 'finds_write_verdict: p_rubric_version is required so a score stays readable after the rubric moves'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    FOR v IN SELECT * FROM jsonb_array_elements(p_verdicts) LOOP
        -- D7, restated where it cannot be skipped. The deferred trigger would
        -- catch this at COMMIT anyway; saying it here names the criterion.
        IF jsonb_array_length(COALESCE(v -> 'citations', '[]'::jsonb)) = 0 THEN
            RAISE EXCEPTION
                'finds_write_verdict: % cites no evidence; DECISIONS D7 requires every C1-C4 score to reference the evidence that justifies it',
                COALESCE(v ->> 'criterion', '(no criterion)')
                USING ERRCODE = 'restrict_violation';
        END IF;

        -- Stale citations first. Safe before the replacements exist precisely
        -- because the trigger is deferred: within one transaction a verdict may
        -- sit momentarily uncited, and only the COMMIT has to be honest.
        DELETE FROM finds_verdict_evidence ve
         WHERE ve.verdict_id IN (
               SELECT id FROM finds_verdicts
                WHERE candidate_id    = p_candidate_id
                  AND evidence_run_id = p_evidence_run_id
                  AND criterion       = v ->> 'criterion');

        INSERT INTO finds_verdicts
               (candidate_id, evidence_run_id, criterion, score, rationale,
                scored_by, rubric_version)
        VALUES (p_candidate_id, p_evidence_run_id, v ->> 'criterion',
                (v ->> 'score')::SMALLINT, v ->> 'rationale', v ->> 'scored_by',
                p_rubric_version)
        ON CONFLICT (candidate_id, evidence_run_id, criterion)
        DO UPDATE SET score          = EXCLUDED.score,
                      rationale      = EXCLUDED.rationale,
                      scored_by      = EXCLUDED.scored_by,
                      rubric_version = EXCLUDED.rubric_version
        RETURNING id INTO v_id;

        -- candidate_id AND evidence_run_id both come from the arguments the
        -- verdict was just written with, never from the citation payload. So
        -- the composite FK makes citing another product's evidence -- or
        -- evidence from a generation this score did not read -- impossible.
        INSERT INTO finds_verdict_evidence
               (verdict_id, evidence_id, candidate_id, evidence_run_id, stance)
        SELECT v_id, (c ->> 'evidence_id')::UUID, p_candidate_id, p_evidence_run_id,
               COALESCE(c ->> 'stance', 'supports')
          FROM jsonb_array_elements(v -> 'citations') AS c;

        written := written + 1;
    END LOOP;

    RETURN written;
END;
$$;

COMMENT ON FUNCTION finds_write_verdict(UUID, UUID, TEXT, JSONB) IS
    'Writes a candidate''s C1-C4 verdicts and their citations in ONE transaction. Required because D7''s deferred trigger cannot be satisfied across two PostgREST requests (D17)';

REVOKE ALL ON FUNCTION finds_write_verdict(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finds_write_verdict(UUID, UUID, TEXT, JSONB) TO service_role;
