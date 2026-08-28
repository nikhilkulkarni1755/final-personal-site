-- ============================================================================
-- Interesting Finds: is product_url a product site, or a tenant on a host?
-- ============================================================================
-- The quality half of D23. W4 has fixed the safety half generically -- crawl
-- scope is now the path prefix rather than the authority -- so the crawler no
-- longer attributes github.com's pages to a project hosted at
-- github.com/owner/repo. This column records what the URL actually IS, so W4
-- and W5 can treat thin shared-host evidence differently instead of each
-- re-deriving it from the URL and disagreeing about the answer.
--
-- Why this is worth a column rather than a helper function: D23 was the worst
-- defect in the build. A real project's README claim was recorded as
-- CONTRADICTED by a sentence from github.com/pricing, and under D7 a
-- contradiction is disqualifying, so the system killed a named third party's
-- project on the basis of words GitHub Inc. wrote. Had the publish path been
-- wired, that false accusation would have gone onto Nikhil's domain. A fact
-- that load-bearing belongs in the row, computed once by the lane that fetched
-- the URL, not recomputed by every reader.
--
-- ---------------------------------------------------------------------------
-- THE DEFAULT: 'unknown', not 'dedicated'. This is a deliberate change from the
-- proposal, and it is the same argument as rubric_version in 20260828210800.
--
-- Existing rows were written before the classifier existed, so we do not know
-- what they are. 'dedicated' is not a neutral placeholder for that -- it is the
-- value that GRANTS CONFIDENCE, the one that tells W4 and W5 "this is a real
-- product site, treat its pages as the project's own". W2's live audit measured
-- 80% of GitHub product URLs and 38% of Show HN's as tenant listings, so
-- defaulting the backlog to 'dedicated' would not merely be unproven, it would
-- be WRONG for most of it, and wrong in precisely the direction that produced
-- the fabricated C1 contradiction.
--
-- 'unknown' is a third value rather than NULL so the honest state is visible in
-- the data: `GROUP BY product_url_kind` shows it, and a reader has to look at
-- it. It is never a lie, and it never reads as an endorsement.
--
-- The column keeps a DEFAULT (rather than being NOT NULL with none, as
-- rubric_version is) for one reason: W2's ingest works today and cannot yet
-- name a column that does not exist. A no-default NOT NULL would break a
-- working lane the moment this merged. So the default absorbs the transition
-- and W2 starts supplying the real value when it ships the write.
--
-- FOLLOW-UP once W2 is writing the column: drop the default, so an unclassified
-- candidate becomes impossible rather than merely visible. Left for a separate
-- migration deliberately -- that one is a breaking change and this one is not.
-- ---------------------------------------------------------------------------
-- ============================================================================

ALTER TABLE finds_candidates
    ADD COLUMN IF NOT EXISTS product_url_kind TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE finds_candidates
    DROP CONSTRAINT IF EXISTS finds_candidates_product_url_kind_check;
ALTER TABLE finds_candidates
    ADD CONSTRAINT finds_candidates_product_url_kind_check
    CHECK (product_url_kind IN (
        'dedicated',    -- the project's own site; its pages are the project's
        'shared_host',  -- a tenant under a path on someone else's host
                        -- (github.com/owner/repo, a Substack, an App Store
                        -- listing). Evidence is thin and scoped to the path.
        'unknown'       -- not classified. Never an endorsement.
    ));

COMMENT ON COLUMN finds_candidates.product_url_kind IS 'What product_url actually is: the project''s own site, a tenant on a shared host, or unclassified. The quality half of D23 -- lets W4/W5 treat thin shared-host evidence as thin instead of re-deriving it';

-- Finding the shared-host and unclassified candidates is the reason the column
-- exists, and both are the minority once the backlog is reclassified.
CREATE INDEX IF NOT EXISTS idx_finds_candidates_url_kind
    ON finds_candidates(product_url_kind)
    WHERE product_url_kind <> 'dedicated';
