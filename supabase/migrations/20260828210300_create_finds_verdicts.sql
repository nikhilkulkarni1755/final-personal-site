-- ============================================================================
-- Interesting Finds: verdicts (the C1-C4 scores)
-- ============================================================================
-- DECISIONS D7: every score must cite the evidence that justifies it, and that
-- has to be referential rather than a free-text field. So the citation is a
-- real join table and the schema makes an unjustified score impossible to
-- insert -- not discouraged, impossible.
--
-- Three mechanisms do that, and each one closes a hole the others leave open:
--
--   1. A DEFERRABLE INITIALLY DEFERRED constraint trigger. At COMMIT, a verdict
--      with no citation aborts the transaction. Deferred rather than immediate
--      because the verdict row necessarily exists before the rows citing it.
--   2. The same check on the other side, so deleting a verdict's last citation
--      cannot strip a live score of its justification after the fact.
--   3. Composite foreign keys. finds_verdict_evidence carries candidate_id and
--      references (id, candidate_id) on BOTH parents, so citing another
--      product's evidence is a foreign-key violation rather than a code review
--      catch.
--
-- Evidence is immutable; verdicts are not. "Verdicts get recomputed against
-- evidence" is the intended direction, so a re-score upserts on
-- (candidate_id, evidence_run_id, criterion) and the citation check runs again.
--
-- NO SEED ROWS (DECISIONS D6).
-- ============================================================================

-- ============================================================================
-- TABLE: finds_verdicts
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_verdicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES finds_candidates(id) ON DELETE RESTRICT,

    -- Which generation of evidence this score was computed from. Evidence is
    -- append-only, so without this a recomputed verdict could silently mix a
    -- fresh crawl with a stale one.
    evidence_run_id UUID NOT NULL,

    criterion TEXT NOT NULL,

    -- How well the evidence supports the criterion. The scale is about
    -- evidential support, not about the product, which is what keeps it
    -- meaningful across all four criteria:
    --   0 the evidence contradicts it
    --   1 no evidence either way
    --   2 partially supported
    --   3 clearly supported by quoted or measured evidence
    -- W5 owns the rubric; if it needs a different scale it proposes one
    -- through the coordinator and W3 migrates it.
    score SMALLINT NOT NULL,

    -- Why, in prose. Supplementary to the citations, never a substitute --
    -- a verdict with a beautiful rationale and no cited evidence still aborts.
    rationale TEXT NOT NULL,

    -- Model id, or 'human'. Needed to compare rubric revisions honestly.
    scored_by TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_verdicts_criterion_check CHECK (criterion IN ('C1', 'C2', 'C3', 'C4')),
    CONSTRAINT finds_verdicts_score_check CHECK (score BETWEEN 0 AND 3),
    CONSTRAINT finds_verdicts_rationale_check CHECK (btrim(rationale) <> ''),
    CONSTRAINT finds_verdicts_scored_by_check CHECK (btrim(scored_by) <> ''),
    CONSTRAINT finds_verdicts_run_criterion_key UNIQUE (candidate_id, evidence_run_id, criterion),
    -- Target for the composite FK from finds_verdict_evidence.
    CONSTRAINT finds_verdicts_id_candidate_key UNIQUE (id, candidate_id)
);

COMMENT ON TABLE finds_verdicts IS 'C1-C4 scores. Every row must cite evidence (DECISIONS D7); the citation check is a deferred constraint trigger, not a convention';
COMMENT ON COLUMN finds_verdicts.evidence_run_id IS 'Which crawl generation was scored. Must match finds_evidence.crawl_run_id of the cited rows';
COMMENT ON COLUMN finds_verdicts.criterion IS 'C1 advertised-is-true, C2 rare problem, C3 usable by anyone, C4 agentic/MCP friendly';
COMMENT ON COLUMN finds_verdicts.score IS '0 contradicted, 1 no evidence, 2 partial, 3 clearly supported. A scale about evidential support, not about the product';
COMMENT ON COLUMN finds_verdicts.rationale IS 'Prose reasoning. Supplementary to the citations and never a substitute for them';

CREATE INDEX IF NOT EXISTS idx_finds_verdicts_candidate
    ON finds_verdicts(candidate_id, evidence_run_id);

DROP TRIGGER IF EXISTS trigger_finds_verdicts_updated_at ON finds_verdicts;
CREATE TRIGGER trigger_finds_verdicts_updated_at
    BEFORE UPDATE ON finds_verdicts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TABLE: finds_verdict_evidence
-- ============================================================================
-- The citation. candidate_id is carried redundantly on purpose: it lets both
-- foreign keys be composite, which is what makes "score for product A cites
-- evidence gathered from product B" structurally impossible.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_verdict_evidence (
    verdict_id UUID NOT NULL,
    evidence_id UUID NOT NULL,
    candidate_id UUID NOT NULL,

    -- Contradicting evidence is a citation too. C1 is a claims-vs-evidence
    -- diff, so the rows that disprove a claim are exactly the ones a score of 0
    -- has to point at.
    stance TEXT NOT NULL DEFAULT 'supports',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (verdict_id, evidence_id),

    CONSTRAINT finds_verdict_evidence_stance_check
        CHECK (stance IN ('supports', 'contradicts')),

    CONSTRAINT finds_verdict_evidence_verdict_fkey
        FOREIGN KEY (verdict_id, candidate_id)
        REFERENCES finds_verdicts(id, candidate_id) ON DELETE CASCADE,

    -- RESTRICT: evidence is append-only, and a cited row must stay reachable.
    CONSTRAINT finds_verdict_evidence_evidence_fkey
        FOREIGN KEY (evidence_id, candidate_id)
        REFERENCES finds_evidence(id, candidate_id) ON DELETE RESTRICT
);

COMMENT ON TABLE finds_verdict_evidence IS 'Which evidence rows justify a score. Composite FKs on both sides make citing another candidate''s evidence impossible';
COMMENT ON COLUMN finds_verdict_evidence.candidate_id IS 'Redundant by design: it is what lets both foreign keys be composite';
COMMENT ON COLUMN finds_verdict_evidence.stance IS 'supports or contradicts. A score of 0 cites the evidence that disproves the claim';

CREATE INDEX IF NOT EXISTS idx_finds_verdict_evidence_evidence
    ON finds_verdict_evidence(evidence_id);

-- ============================================================================
-- THE D7 INVARIANT: no score without a citation
-- ============================================================================
-- SECURITY DEFINER because the check reads finds_verdict_evidence, which is
-- RLS-protected. Under the service role it would work either way, but a
-- function whose correctness depends on which role happens to call it is the
-- exact trap 20251218000000 was written to fix. SET search_path pins
-- resolution so the definer's rights cannot be aimed at another schema.
-- ============================================================================

CREATE OR REPLACE FUNCTION finds_require_verdict_evidence()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    target UUID;
BEGIN
    -- Fired from both sides of the relationship, and the two rowtypes have
    -- different columns, so the branch is on the table rather than a COALESCE.
    IF TG_TABLE_NAME = 'finds_verdicts' THEN
        target := NEW.id;
    ELSE
        target := OLD.verdict_id;
    END IF;

    -- On the citation side the verdict may legitimately be gone (cascade).
    IF NOT EXISTS (SELECT 1 FROM finds_verdicts WHERE id = target) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM finds_verdict_evidence WHERE verdict_id = target) THEN
        RAISE EXCEPTION
            'verdict % has no cited evidence; DECISIONS D7 requires every C1-C4 score to reference the evidence that justifies it',
            target
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION finds_require_verdict_evidence() IS 'Deferred check enforcing DECISIONS D7: a verdict with no evidence citation aborts the transaction';

-- Deferred, because the verdict row has to exist before anything can cite it.
DROP TRIGGER IF EXISTS trigger_finds_verdicts_require_evidence ON finds_verdicts;
CREATE CONSTRAINT TRIGGER trigger_finds_verdicts_require_evidence
    AFTER INSERT OR UPDATE ON finds_verdicts
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION finds_require_verdict_evidence();

-- The other side: removing the last citation must not leave a live score
-- unjustified. Also deferred, so a re-score may delete every citation and
-- insert the new set within one transaction.
DROP TRIGGER IF EXISTS trigger_finds_verdict_evidence_require_evidence ON finds_verdict_evidence;
CREATE CONSTRAINT TRIGGER trigger_finds_verdict_evidence_require_evidence
    AFTER DELETE ON finds_verdict_evidence
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION finds_require_verdict_evidence();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Private. A score on a product we never published is an unpublished opinion
-- about someone else's work.
-- ============================================================================

ALTER TABLE finds_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finds_verdict_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access to finds_verdicts" ON finds_verdicts;
CREATE POLICY "No public access to finds_verdicts"
    ON finds_verdicts FOR ALL
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS "No public access to finds_verdict_evidence" ON finds_verdict_evidence;
CREATE POLICY "No public access to finds_verdict_evidence"
    ON finds_verdict_evidence FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON finds_verdicts FROM anon, authenticated;
REVOKE ALL ON finds_verdict_evidence FROM anon, authenticated;
