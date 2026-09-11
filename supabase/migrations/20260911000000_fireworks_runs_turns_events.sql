-- The agent loop: one input is one run, a run is many turns, and refusals
-- leave a trace.
--
-- fireworks_prompt_usage stays the table the quota trigger guards; one row per
-- submitted input, which is what the visitor is limited to (three, ever). It
-- gains what the loop learns about the run as a whole. Each model turn --
-- one request to the engine, ending in a tool call or a final answer -- is a
-- row in fireworks_turns, capped per run by a trigger the same way inputs are
-- capped per address. Refusals (quota, daily cap, no GPU free) could not be
-- recorded before because the trigger blocks the insert; they get their own
-- table with no trigger.
--
-- The gateway is the only writer of all three; RLS on with no policies.

ALTER TABLE fireworks_prompt_usage
    ADD COLUMN model            TEXT,
    ADD COLUMN turns            INTEGER NOT NULL DEFAULT 0,
    -- What the browser did with the run: applied | out_of_scope | no_change | failed
    ADD COLUMN contract_outcome TEXT,
    ADD COLUMN paths            TEXT[];

CREATE TABLE IF NOT EXISTS fireworks_turns (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        UUID NOT NULL REFERENCES fireworks_prompt_usage(id) ON DELETE CASCADE,
    turn          INTEGER NOT NULL,
    ttft_ms       INTEGER,
    tpot_ms       DOUBLE PRECISION,
    e2e_ms        INTEGER,
    prompt_tokens INTEGER,
    cached_tokens INTEGER,
    output_tokens INTEGER,
    -- [{"name": "grep", "path": "frontend/style.css"}, ...] as the engine emitted them
    tool_calls    JSONB,
    outcome       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, turn)
);

CREATE INDEX IF NOT EXISTS idx_fireworks_turns_run ON fireworks_turns(run_id);
ALTER TABLE fireworks_turns ENABLE ROW LEVEL SECURITY;

-- Twelve model turns per run. The browser stops at the same number; this is
-- the version a modified browser cannot skip.
CREATE OR REPLACE FUNCTION enforce_fireworks_turn_cap()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.turn > 12 THEN
        RAISE EXCEPTION 'turn cap reached for this run'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fireworks_turn_cap ON fireworks_turns;
CREATE TRIGGER trg_fireworks_turn_cap
    BEFORE INSERT ON fireworks_turns
    FOR EACH ROW EXECUTE FUNCTION enforce_fireworks_turn_cap();

CREATE TABLE IF NOT EXISTS fireworks_gateway_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- refused_ip | refused_daily | no_gpu | turn_cap | bad_run
    kind       TEXT NOT NULL,
    ip_hash    TEXT,
    detail     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fireworks_gateway_events_created ON fireworks_gateway_events(created_at);
ALTER TABLE fireworks_gateway_events ENABLE ROW LEVEL SECURITY;
