-- ============================================================================
-- Interesting Finds: finds_write_verdict  (the D7/D17 transaction bridge)
-- ============================================================================
-- Proposed by W5 in finds/score/verdict-rpc.sql and reviewed here. W5's
-- diagnosis is exactly right and worth restating, because it is a real
-- architectural collision and not a bug in either lane:
--
--   D7 is enforced by a DEFERRABLE INITIALLY DEFERRED constraint trigger that
--   fires at COMMIT, so a verdict and its citations must land in ONE
--   transaction. Under D17 every lane reaches the database through PostgREST,
--   which gives one transaction per HTTP request. `insert(verdict)` followed by
--   `insert(citations)` therefore commits the verdict alone; the deferred
--   trigger fires against it uncited and correctly aborts. No two-call sequence
--   can work, and no client-side retry can fix it. The constraint is doing its
--   job; the write simply cannot be expressed as two requests.
--
-- A function is one request and one transaction, so it can. The constraint
-- stays exactly as it is -- this bridges to it rather than weakening it, and
-- every guarantee still holds at COMMIT:
--   * the deferred trigger still runs, and still aborts an uncited verdict
--   * the composite FKs still make citing another product's evidence impossible
--   * candidate_id for each citation comes from the function ARGUMENT, never
--     from the citation payload, so a caller cannot smuggle in a foreign row
--
-- TWO CHANGES from the text W5 submitted. Both are noted so W5 can re-run its
-- proofs against this exact function rather than the proposal:
--
--   1. `stance` is COALESCEd to 'supports'. `INSERT ... SELECT` writes an
--      explicit NULL when the key is absent, and a column DEFAULT does not
--      apply to an explicit NULL -- so a citation omitting `stance` would have
--      failed with a NOT NULL violation instead of taking the default the
--      column already declares. W5 always sends stance today, so this changes
--      no current behaviour; it just makes the function honour its own column.
--   2. It defers D7's constraint triggers explicitly, by name. The function
--      deletes a verdict's stale citations BEFORE inserting the replacements,
--      which leaves the verdict momentarily uncited -- correct only while the
--      trigger is deferred. It is DEFERRABLE INITIALLY DEFERRED, so a fresh
--      PostgREST transaction already satisfies that, but the function was
--      relying on an ambient transaction setting it does not control: any
--      caller that had run SET CONSTRAINTS ... IMMEDIATE earlier in the same
--      transaction would break the re-score path. Found by the re-score test
--      below. Naming the two triggers rather than using ALL keeps the blast
--      radius to D7's own constraints.
--   3. `p_rubric_version` is a new, REQUIRED fourth argument, writing the
--      column added in 20260828210800. Required rather than defaulted because a
--      defaulted version would stamp a rubric onto scores it did not produce.
--      W5 must add it to the .rpc() call; a three-argument call now fails loudly
--      with "function not found" rather than silently recording the wrong rules.
--
-- SECURITY INVOKER, as W5 wrote it, and for W5's stated reason: the pipeline
-- calls this as the service role, which already bypasses RLS, so DEFINER would
-- hand those rights to anyone who could reach the endpoint. PostgREST exposes
-- every function in the schema as a callable endpoint and this one writes, so
-- EXECUTE is revoked from PUBLIC, anon and authenticated below.
--
-- NOT REVIEWED IN: the function does not check that cited evidence belongs to
-- the same crawl generation as p_evidence_run_id. The composite FK already
-- guarantees same-candidate, and adding a same-run constraint now would risk
-- re-blocking the lane this migration exists to unblock. Raised with the
-- coordinator as a follow-up rather than smuggled in here.
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

        -- candidate_id comes from the argument the verdict was just written
        -- with, never from the citation payload, so the composite FK still
        -- makes citing another product's evidence impossible.
        INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id, stance)
        SELECT v_id, (c ->> 'evidence_id')::UUID, p_candidate_id,
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
