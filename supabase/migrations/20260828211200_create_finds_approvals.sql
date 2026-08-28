-- ============================================================================
-- Interesting Finds: finds_approvals  (D29)
-- ============================================================================
-- The durable record of Nikhil saying yes. W8's Telegram poller writes a row;
-- W11's publish path reads one. It exists because an approval must outlive the
-- runner and W8's state is file-backed, so an approval given in Telegram dies
-- with an ephemeral Actions runner and the publish path has nothing to read.
--
-- W11's decoupling is what keeps this small: an APPROVAL must be durable, but
-- the getUpdates OFFSET need not, because re-reading an update we already
-- recorded is absorbed by a unique key. So W8's hard problem does not block
-- publishing, and this table does not try to solve it.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS TABLE DELIBERATELY DOES NOT DO
--
-- There is no view here listing "approved but not yet published" finds, and
-- that absence is a design decision rather than an oversight. Every other
-- workflow in this schema got its convenience view --
-- finds_undigested_candidates, finds_source_health -- precisely because the
-- pipeline is meant to run those unattended. Publishing is the one stage that
-- must not. A ready-made "what should I publish next" query is the single
-- missing ingredient for a three-line cron that turns a missed rejection into a
-- live page about a real company on Nikhil's own domain.
--
-- So a publisher has to write that join itself, deliberately, naming the find.
-- The friction is the feature. Do not add the view later without reopening D29.
-- ---------------------------------------------------------------------------
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- RESTRICT: the record of what he agreed to outlives any tidying up.
    candidate_id UUID NOT NULL REFERENCES finds_candidates(id) ON DELETE RESTRICT,

    -- WHICH EVIDENCE HE ACTUALLY SAW.
    -- Nikhil approves a find on the strength of what the digest showed him. If
    -- the candidate is re-crawled and re-scored afterwards, an approval that
    -- floated free of a generation would let a publish go out citing evidence
    -- he never read -- the same drift the same-run constraint closed one layer
    -- down, and the reason that constraint immediately caught two lanes'
    -- fixtures describing a world we do not build.
    evidence_run_id UUID NOT NULL,

    -- The sentinel half of a composite foreign key, pinned by CHECK, exactly as
    -- finds_evidence.crawl_allowed is. finds_verdicts is unique on
    -- (candidate_id, evidence_run_id, criterion), so pinning the criterion
    -- turns that into a usable FK target and makes "approved a generation that
    -- was never scored" a foreign-key violation rather than a trigger we hope
    -- runs. C1 specifically because finds_write_verdict writes all four
    -- criteria in one transaction, so C1's existence implies the set.
    approved_criterion TEXT NOT NULL DEFAULT 'C1',

    -- D9: Telegram is the control surface; the digest email is read-only and
    -- cannot approve. One member on purpose, matching W11's ApprovalChannel --
    -- an approval arriving by any other route is not representable.
    channel TEXT NOT NULL DEFAULT 'telegram',

    -- The chat the answer came from. Stored so W11 can re-check it against
    -- TELEGRAM_CHAT_ID at read time. W11 already does this and MUST keep doing
    -- it: a table is a wider surface than a file, and the publish path should
    -- not trust that the writer checked.
    chat_id TEXT NOT NULL,

    -- The receipt. Bot API message id of his answer.
    message_id BIGINT NOT NULL,

    -- Provenance for the replay story. Nullable because it is not the
    -- idempotency key -- (chat_id, message_id) is -- and because a coordinator
    -- backfilling an approval by hand has no update id to offer.
    telegram_update_id BIGINT,

    -- Exactly what he sent, verbatim. Never rewritten, never parsed for intent
    -- beyond being non-empty: silence is not consent.
    answer TEXT NOT NULL,

    -- Prose he wrote for the page, or nothing. Carried separately from `answer`
    -- because per D4 the system never authors words in his name, and an option
    -- label he tapped is not something he wrote about the product.
    why_interesting TEXT,

    answered_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_approvals_criterion_check CHECK (approved_criterion = 'C1'),
    CONSTRAINT finds_approvals_channel_check CHECK (channel IN ('telegram')),
    CONSTRAINT finds_approvals_chat_id_check CHECK (btrim(chat_id) <> ''),
    CONSTRAINT finds_approvals_answer_check CHECK (btrim(answer) <> ''),

    -- REPLAY. One Telegram message is one answer. If the poller re-reads an
    -- update after a runner restart, or Nikhil taps the same button twice, the
    -- insert conflicts and nothing new happens. This is the key W11's
    -- decoupling depends on: it is what makes a durable offset unnecessary.
    CONSTRAINT finds_approvals_message_key UNIQUE (chat_id, message_id),

    -- One approval per find per generation, so a resent digest cannot produce
    -- two approvals and thence two published rows. finds_published.candidate_id
    -- is also unique, so this is the outer of two independent guards.
    CONSTRAINT finds_approvals_candidate_run_key UNIQUE (candidate_id, evidence_run_id),

    -- The generation he approved must actually have been scored.
    CONSTRAINT finds_approvals_scored_generation_fkey
        FOREIGN KEY (candidate_id, evidence_run_id, approved_criterion)
        REFERENCES finds_verdicts(candidate_id, evidence_run_id, criterion)
        ON DELETE RESTRICT
);

COMMENT ON TABLE finds_approvals IS 'Durable record of Nikhil approving a find in Telegram (D29). W8 writes, W11 reads. An approval ENABLES a publish; it never triggers one';
COMMENT ON COLUMN finds_approvals.evidence_run_id IS 'The verdict generation he actually saw. Stops a later re-score publishing evidence he never read';
COMMENT ON COLUMN finds_approvals.approved_criterion IS 'Pinned to C1 by CHECK. Exists only to make the FK composite, so approving an unscored generation is impossible';
COMMENT ON COLUMN finds_approvals.chat_id IS 'The chat the answer came from. W11 re-checks it against TELEGRAM_CHAT_ID at read time and must keep doing so';
COMMENT ON COLUMN finds_approvals.answer IS 'His verbatim answer. Non-empty by CHECK: silence is not consent';
COMMENT ON COLUMN finds_approvals.why_interesting IS 'Prose he wrote, or NULL. Per D4 nothing generated is ever written here';

CREATE INDEX IF NOT EXISTS idx_finds_approvals_candidate
    ON finds_approvals(candidate_id, answered_at DESC);

-- ============================================================================
-- APPEND-ONLY
-- ============================================================================
-- An approval is a receipt for something a person said at a moment. Editing one
-- would rewrite the record of consent that a public page about someone else's
-- product rests on, so UPDATE, DELETE and TRUNCATE are refused for every caller
-- including the service role -- RLS cannot do this, because service_role
-- bypasses RLS.
--
-- Consequence worth stating: a change of mind is therefore NOT an edit here. It
-- is a new fact, and it has a home already -- W11's takedown path sets
-- finds_published.published_at to NULL and keeps the row. If revocation ever
-- needs to block a publish that has not happened yet, that is a separate table
-- and a separate decision; it must not be bolted on as a mutable column here,
-- because a nullable revoked_at that no reader checks is worse than nothing.
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_finds_approvals_append_only ON finds_approvals;
CREATE TRIGGER trigger_finds_approvals_append_only
    BEFORE UPDATE OR DELETE ON finds_approvals
    FOR EACH STATEMENT
    EXECUTE FUNCTION finds_reject_mutation();

DROP TRIGGER IF EXISTS trigger_finds_approvals_no_truncate ON finds_approvals;
CREATE TRIGGER trigger_finds_approvals_no_truncate
    BEFORE TRUNCATE ON finds_approvals
    FOR EACH STATEMENT
    EXECUTE FUNCTION finds_reject_mutation();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Private. This is Nikhil's private correspondence with his own bot, and it
-- names finds that are not published and may never be.
-- ============================================================================

ALTER TABLE finds_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access to finds_approvals" ON finds_approvals;
CREATE POLICY "No public access to finds_approvals"
    ON finds_approvals FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON finds_approvals FROM anon, authenticated;
