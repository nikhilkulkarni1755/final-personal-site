-- ============================================================================
-- finds_write_verdict -- PROPOSED BY W5, FOR W3 TO MIGRATE
-- ============================================================================
-- Written in finds/score/ because supabase/migrations/** is W3's. Copy this
-- file's contents into a migration verbatim; nothing here needs editing.
--
-- WHY IT HAS TO EXIST. D7 is enforced by a DEFERRABLE INITIALLY DEFERRED
-- constraint trigger that fires at COMMIT, so a verdict and its citations must
-- be written in ONE transaction. Under D17 every lane reaches the database
-- through supabase-js, i.e. PostgREST -- and PostgREST gives one transaction
-- per HTTP request. Two calls (insert the verdict, then insert its citations)
-- would commit the verdict alone, the deferred trigger would fire against it
-- uncited, and the transaction would abort. That is the schema working exactly
-- as designed; it simply means the write cannot be expressed as two requests.
-- A function is one request and one transaction, so it can.
--
-- The guards below duplicate ones W5 already applies in TypeScript, on purpose:
-- the client-side check exists to fail early with a readable message, and this
-- one exists because a check that lives only in the caller is not a check.
--
-- SECURITY INVOKER: the pipeline calls this as the service role, which already
-- bypasses RLS. A DEFINER function would grant its rights to whoever could
-- call it, so EXECUTE is revoked from anon and authenticated below -- PostgREST
-- exposes every function in the schema as an endpoint, and this one writes.
-- ============================================================================

CREATE OR REPLACE FUNCTION finds_write_verdict(
    p_candidate_id    UUID,
    p_evidence_run_id UUID,
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
               (candidate_id, evidence_run_id, criterion, score, rationale, scored_by)
        VALUES (p_candidate_id, p_evidence_run_id, v ->> 'criterion',
                (v ->> 'score')::SMALLINT, v ->> 'rationale', v ->> 'scored_by')
        ON CONFLICT (candidate_id, evidence_run_id, criterion)
        DO UPDATE SET score     = EXCLUDED.score,
                      rationale = EXCLUDED.rationale,
                      scored_by = EXCLUDED.scored_by
        RETURNING id INTO v_id;

        -- candidate_id comes from the argument the verdict was just written
        -- with, never from the citation payload, so the composite FK still
        -- makes citing another product's evidence impossible.
        INSERT INTO finds_verdict_evidence (verdict_id, evidence_id, candidate_id, stance)
        SELECT v_id, (c ->> 'evidence_id')::UUID, p_candidate_id, c ->> 'stance'
          FROM jsonb_array_elements(v -> 'citations') AS c;

        written := written + 1;
    END LOOP;

    RETURN written;
END;
$$;

COMMENT ON FUNCTION finds_write_verdict(UUID, UUID, JSONB) IS
    'Writes a candidate''s C1-C4 verdicts and their citations in ONE transaction. Required because D7''s deferred trigger cannot be satisfied across two PostgREST requests (D17)';

REVOKE ALL ON FUNCTION finds_write_verdict(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finds_write_verdict(UUID, UUID, JSONB) TO service_role;
