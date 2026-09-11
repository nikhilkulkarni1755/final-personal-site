-- A wake the gateway abandoned because the worker stayed throttled is our
-- capacity problem, not the visitor's input. Same rule as wake_timeout.

CREATE OR REPLACE FUNCTION enforce_fireworks_prompt_limit()
RETURNS TRIGGER AS $$
DECLARE
    used  INTEGER;
    today INTEGER;
BEGIN
    IF NEW.ip_hash IS NULL THEN
        RAISE EXCEPTION 'ip_hash is required' USING ERRCODE = 'not_null_violation';
    END IF;

    LOCK TABLE fireworks_prompt_usage IN SHARE ROW EXCLUSIVE MODE;

    SELECT COUNT(*) INTO used
      FROM fireworks_prompt_usage
     WHERE ip_hash = NEW.ip_hash
       AND outcome IS DISTINCT FROM 'wake_timeout'
       AND outcome IS DISTINCT FROM 'no_gpu'
       AND outcome IS DISTINCT FROM 'engine_error';
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
