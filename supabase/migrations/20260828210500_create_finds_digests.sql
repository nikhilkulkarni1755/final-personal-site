-- ============================================================================
-- Interesting Finds: digests
-- ============================================================================
-- What we emailed, when, and which candidates were in it -- so we never send
-- Nikhil the same find twice.
--
-- The subtlety is that "never twice" must survive a FAILED send. A plain
-- UNIQUE(candidate_id) on the items would burn a candidate the moment it was
-- put in a digest, so a digest that failed to send would silently destroy the
-- finds Nikhil never saw. And simply deleting the failed digest to free them
-- would erase the record that a send failed, which DECISIONS D2 and D6 exist to
-- prevent: we do not quietly tidy away failures.
--
-- So the invariant is narrower and exact: a candidate may appear in at most one
-- SENT digest. It is a partial unique index over a status mirrored onto the
-- items by trigger. Failed digests keep their rows, keep their error, and
-- release their candidates back into the pool.
--
-- Per D2 the provider is Gmail SMTP and W6 must never fake a successful send.
-- That is a CHECK here too: 'sent' requires a sent_at, 'failed' requires an
-- error. A row cannot claim delivery it did not get.
--
-- NO SEED ROWS (DECISIONS D6).
-- ============================================================================

-- ============================================================================
-- TABLE: finds_digests
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_digests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    subject TEXT NOT NULL,
    recipient TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMPTZ,

    -- Whatever the transport gave back. Evidence that a send really happened.
    provider_message_id TEXT,

    -- Verbatim failure. Never a credential: D2 forbids echoing GMAIL_APP_PASSWORD
    -- into any log, and this column is a log.
    error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT finds_digests_status_check CHECK (status IN ('pending', 'sent', 'failed')),
    CONSTRAINT finds_digests_subject_check CHECK (btrim(subject) <> ''),
    CONSTRAINT finds_digests_recipient_check CHECK (btrim(recipient) <> ''),
    -- A digest cannot claim delivery it did not get, and cannot fail silently.
    CONSTRAINT finds_digests_sent_check
        CHECK (status <> 'sent' OR sent_at IS NOT NULL),
    CONSTRAINT finds_digests_failed_check
        CHECK (status <> 'failed' OR error IS NOT NULL)
);

COMMENT ON TABLE finds_digests IS 'One row per digest email attempt. A failed attempt keeps its row and its error (DECISIONS D2, D6)';
COMMENT ON COLUMN finds_digests.status IS 'pending until a send is attempted. sent requires sent_at; failed requires error. No faked deliveries';
COMMENT ON COLUMN finds_digests.error IS 'Verbatim failure. Never a credential -- D2 forbids echoing the app password anywhere';

CREATE INDEX IF NOT EXISTS idx_finds_digests_status
    ON finds_digests(status, created_at DESC);

DROP TRIGGER IF EXISTS trigger_finds_digests_updated_at ON finds_digests;
CREATE TRIGGER trigger_finds_digests_updated_at
    BEFORE UPDATE ON finds_digests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TABLE: finds_digest_items
-- ============================================================================

CREATE TABLE IF NOT EXISTS finds_digest_items (
    digest_id UUID NOT NULL REFERENCES finds_digests(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES finds_candidates(id) ON DELETE RESTRICT,

    -- Order in the email, so the digest can be reconstructed exactly.
    position SMALLINT NOT NULL,

    -- Mirror of the parent digest's status, maintained by trigger. It exists
    -- only so the "at most one SENT digest per candidate" rule can be a partial
    -- unique index -- Postgres cannot build one across a join.
    digest_status TEXT NOT NULL DEFAULT 'pending',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (digest_id, candidate_id),
    CONSTRAINT finds_digest_items_position_check CHECK (position >= 0),
    CONSTRAINT finds_digest_items_status_check
        CHECK (digest_status IN ('pending', 'sent', 'failed'))
);

COMMENT ON TABLE finds_digest_items IS 'Which candidates went into which digest, in order';
COMMENT ON COLUMN finds_digest_items.digest_status IS 'Trigger-maintained mirror of finds_digests.status. Exists so the never-twice rule can be a partial unique index';

-- THE INVARIANT: a candidate may appear in at most one SENT digest. Pending and
-- failed digests do not consume it, so a send that never reached Nikhil does
-- not destroy the finds he never saw.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finds_digest_items_sent_once
    ON finds_digest_items(candidate_id)
    WHERE digest_status = 'sent';

CREATE INDEX IF NOT EXISTS idx_finds_digest_items_candidate
    ON finds_digest_items(candidate_id);

-- ============================================================================
-- Mirroring the parent status onto the items
-- ============================================================================
-- SECURITY DEFINER with a pinned search_path: this writes to an RLS-protected
-- table from a trigger, which is precisely the case
-- 20251218000000_fix_rls_and_trigger_permissions.sql was written to fix.
-- ============================================================================

CREATE OR REPLACE FUNCTION finds_sync_digest_item_status()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE finds_digest_items
       SET digest_status = NEW.status
     WHERE digest_id = NEW.id
       AND digest_status IS DISTINCT FROM NEW.status;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION finds_sync_digest_item_status() IS 'Mirrors finds_digests.status onto its items so the at-most-one-sent-digest rule can be a partial unique index (SECURITY DEFINER to write past RLS)';

DROP TRIGGER IF EXISTS trigger_finds_digests_sync_items ON finds_digests;
CREATE TRIGGER trigger_finds_digests_sync_items
    AFTER UPDATE OF status ON finds_digests
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION finds_sync_digest_item_status();

-- ============================================================================
-- VIEW: finds_undigested_candidates
-- ============================================================================
-- What W6 may still put in a digest. Keeps the never-twice rule in one place
-- rather than in a NOT EXISTS clause each caller writes for itself.
-- security_invoker = true so it cannot be used to read past RLS.
-- ============================================================================

CREATE OR REPLACE VIEW finds_undigested_candidates
WITH (security_invoker = true) AS
SELECT c.*
  FROM finds_candidates c
 WHERE NOT EXISTS (
        SELECT 1 FROM finds_digest_items i
         WHERE i.candidate_id = c.id
           AND i.digest_status = 'sent'
       );

COMMENT ON VIEW finds_undigested_candidates IS 'Candidates not yet in a successfully sent digest. A failed send does not consume a candidate';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Private. What we mailed Nikhil, and what we failed to mail him, is his.
-- ============================================================================

ALTER TABLE finds_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE finds_digest_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access to finds_digests" ON finds_digests;
CREATE POLICY "No public access to finds_digests"
    ON finds_digests FOR ALL
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS "No public access to finds_digest_items" ON finds_digest_items;
CREATE POLICY "No public access to finds_digest_items"
    ON finds_digest_items FOR ALL
    USING (false)
    WITH CHECK (false);

REVOKE ALL ON finds_digests FROM anon, authenticated;
REVOKE ALL ON finds_digest_items FROM anon, authenticated;
REVOKE ALL ON finds_undigested_candidates FROM anon, authenticated;
