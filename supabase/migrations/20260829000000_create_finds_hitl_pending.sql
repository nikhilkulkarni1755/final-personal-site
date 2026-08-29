-- ============================================================================
-- Interesting Finds: finds_hitl_pending  (D34)
-- ============================================================================
-- The open questions waiting for Nikhil in Telegram. W8's ask writes a row; the
-- one poller reads it, records a draft note, and deletes it when answered.
--
-- WHY IT IS A TABLE. Telegram's getUpdates offset is global per bot token, so
-- whoever polls first consumes an update for everyone. That is D34's rule
-- problem and W8 has taken it. The SECOND half is storage: the pending store was
-- file-backed, so the coordinator's ask and W8's poll wrote two different files
-- for one bot, the poller found no pending entry for a real tap, never called
-- answerCallbackQuery, and Telegram spun forever. That is what Nikhil saw as
-- "the buttons aren't clickable" -- his taps registered and we dropped them.
--
-- W8's PR #45 anchored the file to its own location instead of the working
-- directory, and was explicit that this fixes two invocations of the same
-- checkout and does nothing for two worktrees -- which is exactly the case that
-- bit us. Postgres is the one location that resolves identically from any
-- worktree, any host, any future Actions runner. Same reasoning that gave
-- finds_approvals a durable home one layer up: an approval must outlive the
-- process, and a pending QUESTION must be visible to whichever process polls,
-- regardless of which process asked.
--
-- Shape proposed by W8 in finds-coord/lanes/W8.md Pass 5. Three changes on
-- review, each noted at the constraint that carries it.
--
-- NO SEED ROWS (DECISIONS D6).
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_hitl_pending (
    -- CLIENT-GENERATED, and deliberately WITHOUT a default.
    --
    -- Every other table here defaults its id to gen_random_uuid(). This one
    -- must not, and the absence is the point: the question id is embedded in
    -- Telegram's callback_data ("q:<id>:<idx>") before the row exists, so it
    -- has to come from the caller. A DEFAULT would be actively harmful -- a
    -- writer that forgot to pass its id would get a server-generated one that
    -- is NOT the id in the button, producing a row no tap can ever match. That
    -- is precisely the silent failure this table exists to end. With no
    -- default, forgetting is a NOT NULL violation instead.
    --
    -- (A UUID also fits: callback_data is capped at 64 bytes and "q:<uuid>:<n>"
    -- is about 41.)
    id UUID PRIMARY KEY,

    chat_id TEXT NOT NULL,
    -- The ASK's own Bot API message id.
    sent_message_id BIGINT NOT NULL,

    prompt TEXT NOT NULL,
    context TEXT,
    -- [{ "label": "..." }], or NULL for a free-text-only ask.
    options JSONB,

    kind TEXT NOT NULL DEFAULT 'plain',

    -- Present iff kind = 'approval'. Pinning approval_criterion to 'C1' makes
    -- the foreign key below composite, exactly as finds_approvals does, so a
    -- pending ask about a never-scored generation is a foreign-key violation --
    -- one layer EARLIER than finds_approvals catches it. You cannot even ask
    -- the question, let alone answer it.
    approval_candidate_id UUID REFERENCES finds_candidates(id) ON DELETE RESTRICT,
    approval_evidence_run_id UUID,
    approval_criterion TEXT,
    approve_option_index SMALLINT,

    -- D32: free text is CAPTURED, never acted on. Only an explicit tap
    -- approves. This holds what he typed before any tap, and becomes
    -- finds_approvals.why_interesting only if a later tap approves. Per D4 it
    -- is his prose, verbatim, and nothing generated is ever written here.
    draft_note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_hitl_pending_kind_check CHECK (kind IN ('plain', 'approval')),
    CONSTRAINT finds_hitl_pending_chat_id_check CHECK (btrim(chat_id) <> ''),
    CONSTRAINT finds_hitl_pending_prompt_check CHECK (btrim(prompt) <> ''),
    CONSTRAINT finds_hitl_pending_criterion_check
        CHECK (approval_criterion IS NULL OR approval_criterion = 'C1'),
    CONSTRAINT finds_hitl_pending_options_array_check
        CHECK (options IS NULL OR jsonb_typeof(options) = 'array'),

    -- An approval ask carries its whole approval payload; a plain ask carries
    -- none of it. draft_note is exempt from the plain branch on purpose -- a
    -- plain question can still collect free text.
    CONSTRAINT finds_hitl_pending_kind_fields_check CHECK (
        (kind = 'plain'
            AND approval_candidate_id IS NULL
            AND approval_evidence_run_id IS NULL
            AND approval_criterion IS NULL
            AND approve_option_index IS NULL)
        OR
        (kind = 'approval'
            AND approval_candidate_id IS NOT NULL
            AND approval_evidence_run_id IS NOT NULL
            AND approval_criterion IS NOT NULL
            AND approve_option_index IS NOT NULL)
    ),

    -- CHANGE ON REVIEW (1 of 3). W8's shape allowed kind='approval' with
    -- options NULL, or with an approve index past the end of the list. Either
    -- produces a question whose approving button does not exist -- and since
    -- D32 makes the tap the ONLY thing that can approve, an unreachable tap
    -- means a find Nikhil can never say yes to, failing silently as a question
    -- that simply never resolves. The bound is cheap to state, so state it.
    CONSTRAINT finds_hitl_pending_approve_option_check CHECK (
        approve_option_index IS NULL
        OR (options IS NOT NULL
            AND jsonb_typeof(options) = 'array'
            AND approve_option_index >= 0
            AND approve_option_index < jsonb_array_length(options))
    ),

    -- The lookup key the poller uses, and the reason findBySentMessageId gains
    -- a chat_id parameter: sent_message_id is Telegram's PER-CHAT counter, so
    -- the chat has to be in the key. Same correction made for finds_approvals.
    CONSTRAINT finds_hitl_pending_message_key UNIQUE (chat_id, sent_message_id),

    -- CHANGE ON REVIEW (2 of 3): MATCH FULL rather than the default.
    -- With MATCH SIMPLE, a foreign key whose columns are partly NULL is not
    -- checked AT ALL. The kind CHECK above happens to prevent that today, so
    -- the two constraints are load-bearing together -- and anyone who later
    -- loosened the kind CHECK would silently disable this foreign key without
    -- touching it. MATCH FULL makes the all-or-nothing rule the key's own, so
    -- it cannot be switched off from a distance.
    CONSTRAINT finds_hitl_pending_scored_generation_fkey
        FOREIGN KEY (approval_candidate_id, approval_evidence_run_id, approval_criterion)
        REFERENCES finds_verdicts(candidate_id, evidence_run_id, criterion)
        MATCH FULL
        ON DELETE RESTRICT
);

COMMENT ON TABLE finds_hitl_pending IS 'Open Telegram questions awaiting Nikhil (D34). Shared so the process that asks and the process that polls see one store, whatever worktree they run from';
COMMENT ON COLUMN finds_hitl_pending.id IS 'Client-generated, no default: it is in the callback_data before the row exists, and a server default would produce a row no tap can match';
COMMENT ON COLUMN finds_hitl_pending.sent_message_id IS 'Bot API message id of the ask. Per-chat counter, hence UNIQUE with chat_id';
COMMENT ON COLUMN finds_hitl_pending.approval_criterion IS 'Pinned to C1. Exists only to make the FK composite, so asking about an unscored generation is impossible';
COMMENT ON COLUMN finds_hitl_pending.approve_option_index IS 'Which option approves. Bounded against options, because D32 makes the tap the only thing that can approve';
COMMENT ON COLUMN finds_hitl_pending.draft_note IS 'D32: free text captured, never acted on. His prose verbatim; nothing generated is ever written here';

-- ============================================================================
-- MUTABLE AND DELETABLE, unlike finds_approvals and finds_evidence
-- ============================================================================
-- CHANGE ON REVIEW (3 of 3) is that there is no change: W8 asked whether a
-- queue and a receipt may share a schema, and they may. The rule this schema
-- has actually been applying is narrower than "audit tables are append-only" --
-- it is that a record something ELSE RELIES ON AS EVIDENCE must not move.
-- finds_evidence backs verdicts; finds_crawl_verdicts answers "why did you
-- crawl me"; finds_approvals is the consent a public page about someone else's
-- product rests on. Nothing rests on a pending question once it is answered:
-- the approval row is what W11 reads, and D29 already settled that rejections
-- leave no trace.
--
-- Append-only here would be worse, not stricter. It would force a resolved_at
-- column, and "is this question still open?" would become a filter every reader
-- has to remember instead of "is there a row?". That is the same failure mode
-- that kept revoked_at out of finds_approvals: a column readers must consult is
-- a safeguard only if they consult it. Deleting the row is the honest encoding
-- of "this question is over", and it mirrors PendingStore.remove() exactly.
--
-- If an audit trail of every ask, rejections included, is ever wanted, that is
-- a new table and a new decision -- not a mutable column bolted on here.
-- ============================================================================

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Private, identical posture to finds_approvals. draft_note holds Nikhil's
-- unsent prose and the prompts name finds that are not published and may never
-- be. Nothing here is ever anon-readable.
-- ============================================================================

ALTER TABLE finds_hitl_pending ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access to finds_hitl_pending" ON finds_hitl_pending;
CREATE POLICY "No public access to finds_hitl_pending"
    ON finds_hitl_pending FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON finds_hitl_pending FROM anon, authenticated;
