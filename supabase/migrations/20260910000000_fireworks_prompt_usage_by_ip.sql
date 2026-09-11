-- Re-key the prompt quota on IP, and make the gateway its only writer.
--
-- The first version keyed on a browser fingerprint and let anon INSERT, so the
-- limit was a speed bump. Now the row is written by the gateway with the
-- service role, keyed on CF-Connecting-IP hashed with the same SHA-256 the
-- analytics uses for `ip_hash`, and the browser has no path to this table at
-- all. RLS stays enabled with no policies: that is "nobody but the service
-- role", which is the intent.
--
-- Two limits, both as invariants the gateway cannot forget to check:
--   3 prompts per address, ever      (the demo's per-visitor budget)
--   40 prompts per UTC day, globally (the spend ceiling: every one of them cold
--                                     is ~3 GPU-hours, about $15 at $4.79/hr)
-- gateway/src/index.ts carries the same two numbers and matches on the words
-- "quota" and "daily" in the error text to tell the visitor which one hit.
--
-- The timing columns are written back after the stream ends and are what
-- Grafana charts as "what the visitor waited".

ALTER TABLE fireworks_prompt_usage
    DROP COLUMN visitor_id,
    ADD COLUMN ip_hash       TEXT,
    ADD COLUMN wake_ms       INTEGER,
    ADD COLUMN ttft_ms       INTEGER,
    ADD COLUMN tpot_ms       DOUBLE PRECISION,
    ADD COLUMN e2e_ms        INTEGER,
    ADD COLUMN output_tokens INTEGER,
    ADD COLUMN outcome       TEXT;

CREATE INDEX IF NOT EXISTS idx_fireworks_prompt_usage_ip
    ON fireworks_prompt_usage(ip_hash);
CREATE INDEX IF NOT EXISTS idx_fireworks_prompt_usage_created
    ON fireworks_prompt_usage(created_at);

DROP POLICY IF EXISTS "anyone can read prompt usage" ON fireworks_prompt_usage;
DROP POLICY IF EXISTS "anyone can record a prompt"   ON fireworks_prompt_usage;

CREATE OR REPLACE FUNCTION enforce_fireworks_prompt_limit()
RETURNS TRIGGER AS $$
DECLARE
    used  INTEGER;
    today INTEGER;
BEGIN
    IF NEW.ip_hash IS NULL THEN
        RAISE EXCEPTION 'ip_hash is required' USING ERRCODE = 'not_null_violation';
    END IF;

    -- Serialise concurrent inserts, so two prompts racing cannot both read
    -- "2 used" and both get through. A limit with a race is not a limit.
    LOCK TABLE fireworks_prompt_usage IN SHARE ROW EXCLUSIVE MODE;

    SELECT COUNT(*) INTO used
      FROM fireworks_prompt_usage
     WHERE ip_hash = NEW.ip_hash;
    IF used >= 3 THEN
        RAISE EXCEPTION 'prompt quota exhausted for this address'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT COUNT(*) INTO today
      FROM fireworks_prompt_usage
     WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'utc');
    IF today >= 40 THEN
        RAISE EXCEPTION 'daily prompt budget exhausted'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
