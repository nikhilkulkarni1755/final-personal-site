-- ============================================================================
-- Interesting Finds: evidence must cite ITS OWN candidate's gate decision
-- ============================================================================
-- Found by W4 attacking the constraint against a real database rather than
-- trusting that no row violated it. The attack matrix:
--
--   evidence citing a DENY verdict ..................... REFUSED  (correct)
--   evidence citing ANOTHER CANDIDATE'S ALLOW verdict .. INSERTED (the gap)
--   UPDATE / DELETE an evidence row .................... REFUSED, service role
--                                                        included (correct)
--
-- finds_evidence_crawl_verdict_fkey was FOREIGN KEY (crawl_verdict_id,
-- crawl_allowed) -> finds_crawl_verdicts(id, allowed). It pins allowed = true
-- and omits candidate_id, so a page could be recorded against candidate B while
-- citing the verdict that permitted candidate A.
--
-- WHY THIS IS THE SAME BUG AS D23. D23 was the crawler attributing GitHub Inc.'s
-- pages to a tenant project, which produced a fabricated C1 contradiction and
-- disqualified a real person's project under D7. This is that shape expressed
-- one table over: evidence attributed to a candidate whose gate never covered
-- it. The schema already refuses cross-candidate CITATION
-- (finds_verdict_evidence) and cross-generation citation (the same-run
-- constraint); this was the remaining hole in the same wall.
--
-- The fix is the widening used for the same-run constraint: put candidate_id in
-- the key. finds_evidence already carries it, so nothing new is stored.
--
-- ---------------------------------------------------------------------------
-- CAN THIS BE APPLIED TO THE LIVE TABLE? YES -- and the answer needs the
-- reasoning, because the naive form of this migration WOULD fail.
--
-- Proving the gap left a permanent junk row in production:
--     id           1fb9f3ba-48f6-4689-84a2-664f26317c62
--     url          https://attack.test/
--     crawl_run_id 00000000-0000-0000-0000-0000000000ff
-- It cannot be deleted, because finds_evidence is append-only and that is the
-- guard working correctly. It VIOLATES the constraint below -- being a
-- cross-candidate row is the whole point of it.
--
-- So the constraint is added NOT VALID. That is not a weakening: Postgres
-- enforces a NOT VALID foreign key on every subsequent INSERT and UPDATE, and
-- skips only the one-time scan of rows already present. Because finds_evidence
-- is append-only, "rows already present" is a closed set that can never grow or
-- change, so every row this constraint will ever fail to have checked already
-- exists today and is known: 133 real rows that satisfy it, and one that does
-- not. Every future row is fully checked.
--
-- It therefore CANNOT fail on apply, at any table size -- NOT VALID does no
-- scan. The unique index it needs is on finds_crawl_verdicts(id, ...), where id
-- is the primary key, so that index cannot collide either.
--
-- DO NOT run VALIDATE CONSTRAINT on this. It will fail on the junk row, and it
-- is meant to: the row is a real historical fact about this database and the
-- append-only rule says facts do not get tidied away. The alternative --
-- dropping the append-only trigger, deleting the row, restoring the trigger --
-- was considered and rejected. It would leave a worked example in this
-- repository of how to circumvent evidence immutability, and the guarantee that
-- evidence backing a verdict cannot move is worth more than a clean constraint
-- status. One permanently NOT VALID constraint is the cheaper scar.
-- ---------------------------------------------------------------------------
-- ============================================================================

-- Release the foreign key before touching its target, so this re-applies. The
-- same ordering the same-run migration needed.
ALTER TABLE finds_evidence
    DROP CONSTRAINT IF EXISTS finds_evidence_crawl_verdict_fkey;

-- Widen the target. `id` is already the primary key of finds_crawl_verdicts, so
-- this adds no new uniqueness and cannot fail against existing rows; it exists
-- only to be referenced.
ALTER TABLE finds_crawl_verdicts
    DROP CONSTRAINT IF EXISTS finds_crawl_verdicts_id_candidate_allowed_key;
ALTER TABLE finds_crawl_verdicts
    ADD CONSTRAINT finds_crawl_verdicts_id_candidate_allowed_key
    UNIQUE (id, candidate_id, allowed);

-- The gate, now covering WHOSE gate it was.
-- crawl_allowed stays pinned true by its own CHECK, so this single key says:
-- this page was fetched under a verdict that (a) exists, (b) was an ALLOW, and
-- (c) was issued for this very candidate.
ALTER TABLE finds_evidence
    ADD CONSTRAINT finds_evidence_crawl_verdict_fkey
    FOREIGN KEY (crawl_verdict_id, candidate_id, crawl_allowed)
    REFERENCES finds_crawl_verdicts(id, candidate_id, allowed)
    ON DELETE RESTRICT
    NOT VALID;

COMMENT ON COLUMN finds_evidence.crawl_verdict_id IS 'The gate decision that permitted this fetch. Composite FK on (id, candidate_id, allowed): the verdict must be an ALLOW AND must belong to this candidate';
COMMENT ON COLUMN finds_evidence.crawl_allowed IS 'Pinned true by CHECK. Exists solely to make the FK to finds_crawl_verdicts composite';

-- Now unreferenced: the new key covers everything the two-column one did.
-- Dropped rather than left beside it, because the weaker half of a redundant
-- pair is the half a future reader trusts.
ALTER TABLE finds_crawl_verdicts
    DROP CONSTRAINT IF EXISTS finds_crawl_verdicts_id_allowed_key;
