-- The dataset the page builds: every run, publicly readable, no addresses.
--
-- The gateway writes runs and turns under the service role and RLS keeps anon
-- out of both tables. This view is the one thing anon may read: per run, what
-- was asked, what the model did, and every latency the gateway measured, with
-- the per-turn rows rolled up. It is created as the owner (not
-- security_invoker), which is what lets it read the RLS-protected tables on
-- anon's behalf while exposing only these columns. ip_hash is not among them.

ALTER TABLE fireworks_prompt_usage
    -- SGLang's own startup timer (scheduler end to end, seconds) as the wake
    -- heartbeat last saw it on turn one. Null when the engine was already warm.
    ADD COLUMN IF NOT EXISTS engine_boot_s DOUBLE PRECISION;

CREATE OR REPLACE VIEW fireworks_runs_public AS
SELECT
    r.id,
    r.created_at,
    r.prompt,
    r.model,
    r.outcome,
    r.contract_outcome,
    r.paths,
    r.turns,
    r.wake_ms,
    r.ttft_ms,                       -- turn one, send -> first token; carries the boot when cold
    r.engine_boot_s,
    r.e2e_ms,                        -- whole run, first send -> final word
    t.mean_tpot_ms,
    t.mean_turn_ttft_ms,             -- turns two onward: what a warm turn costs to first token
    t.prompt_tokens,
    t.cached_tokens,
    t.output_tokens
FROM fireworks_prompt_usage r
LEFT JOIN LATERAL (
    SELECT
        avg(tt.tpot_ms)                                       AS mean_tpot_ms,
        avg(tt.ttft_ms) FILTER (WHERE tt.turn > 1)            AS mean_turn_ttft_ms,
        sum(tt.prompt_tokens)                                 AS prompt_tokens,
        sum(tt.cached_tokens)                                 AS cached_tokens,
        sum(tt.output_tokens)                                 AS output_tokens
    FROM fireworks_turns tt
    WHERE tt.run_id = r.id
) t ON true
WHERE r.outcome IS NOT NULL;

GRANT SELECT ON fireworks_runs_public TO anon, authenticated;
