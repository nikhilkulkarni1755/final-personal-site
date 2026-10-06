-- The cold start as five stages, recorded per run by the gateway on turn one:
-- container_s, init_s, weights_s, graphs_s, warmup_s (seconds), plus the
-- scheduler's own end-to-end boot, scheduler_e2e_s. Null when the run was warm.
ALTER TABLE fireworks_prompt_usage
    ADD COLUMN IF NOT EXISTS boot_stages JSONB;

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
    r.boot_stages,
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

NOTIFY pgrst, 'reload schema';
