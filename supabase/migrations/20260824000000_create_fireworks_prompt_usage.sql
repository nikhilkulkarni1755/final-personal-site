-- Per-visitor prompt quota for /spearfishing/fireworks-ai.
--
-- Follows the `likes` pattern, which is the one place in this schema where a
-- limit is a database invariant rather than app logic: anon may INSERT and
-- nothing else, so a modified client cannot edit its own count down.
--
-- Deliberately NOT the marketplace pattern. `marketplace_users` has RLS off and
-- lets the browser run `UPDATE ... SET token_balance`, which enforces nothing.
--
-- What this does and does not buy: visitor_id is a fingerprint computed in the
-- browser, so a new browser is a new visitor. This stops casual overuse. The
-- spending limit that actually binds is in the gateway, keyed on IP, with a
-- daily GPU-minute ceiling behind it.

CREATE TABLE IF NOT EXISTS fireworks_prompt_usage (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id  TEXT NOT NULL,
    prompt      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fireworks_prompt_usage_visitor
    ON fireworks_prompt_usage(visitor_id);

ALTER TABLE fireworks_prompt_usage ENABLE ROW LEVEL SECURITY;

-- Read your own count (the client needs it to render "2 of 3 left").
CREATE POLICY "anyone can read prompt usage"
    ON fireworks_prompt_usage FOR SELECT
    USING (true);

-- Append only. No UPDATE or DELETE policy exists, so anon has neither.
CREATE POLICY "anyone can record a prompt"
    ON fireworks_prompt_usage FOR INSERT
    WITH CHECK (true);

-- The limit as an invariant. A client that skips the check still cannot exceed
-- it, because the fourth insert for a visitor is refused by the database.
CREATE OR REPLACE FUNCTION enforce_fireworks_prompt_limit()
RETURNS TRIGGER AS $$
DECLARE
    used INTEGER;
BEGIN
    SELECT COUNT(*) INTO used
      FROM fireworks_prompt_usage
     WHERE visitor_id = NEW.visitor_id;

    IF used >= 3 THEN
        RAISE EXCEPTION 'prompt quota exhausted for this visitor'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fireworks_prompt_limit ON fireworks_prompt_usage;
CREATE TRIGGER trg_fireworks_prompt_limit
    BEFORE INSERT ON fireworks_prompt_usage
    FOR EACH ROW EXECUTE FUNCTION enforce_fireworks_prompt_limit();
