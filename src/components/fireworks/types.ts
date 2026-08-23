/**
 * Types mirroring data/schema.json in the fireworks_ai_spearfishing repo.
 *
 * That schema is the contract between the measurement harness and this page.
 * If it changes, these types and the loader in useCaptures must change with it —
 * the page deliberately renders nothing that is not present in a capture file.
 */

export type RunSource = 'measured' | 'synthetic';
export type RunMode = 'colocated' | 'disaggregated';
export type Pool = 'prefill' | 'decode' | 'colocated';

export interface Rig {
  label: string;
  gpus: number;
  gpu_model: string;
  gpu_memory_gb?: number;
  interconnect?: string;
  provider: string;
  region?: string;
  usd_per_hour?: number;
}

export interface ModelInfo {
  id: string;
  dtype: string;
  total_params_b?: number;
  active_params_b?: number;
  weights_gb?: number;
  context_length?: number;
}

export interface EngineInfo {
  name: string;
  version: string;
  kv_transfer_backend?: string;
  router_version?: string;
}

export interface PoolUtilSample {
  t_ms: number;
  prefill_util?: number;
  decode_util?: number;
  queue_depth?: number;
  kv_transfer_ms?: number;
}

export interface CaptureRequest {
  id: string;
  prompt: string;
  shares_prefix: boolean;
  prompt_tokens: number;
  output_tokens: number;
  ttft_ms: number;
  itl_ms: number[];
  total_ms?: number;
  cache_hit_tokens?: number;
  cache_total_tokens?: number;
  started_at_ms?: number;
  pool?: Pool;
  pool_util_samples?: PoolUtilSample[];
  target_file?: string;
  output_text?: string;
  error?: string;
}

export interface CaptureSet {
  title: string;
  description?: string;
  concurrency: number;
  requests: CaptureRequest[];
}

export interface CaptureRun {
  schema_version: number;
  run_id: string;
  timestamp: string;
  source: RunSource;
  notes?: string;
  rig: Rig;
  model: ModelInfo;
  engine: EngineInfo;
  mode: RunMode;
  flags_used: Record<string, string[]>;
  prefix: { sha256: string; approx_tokens: number; chars?: number };
  sets: { set1?: CaptureSet; set2?: CaptureSet; set3?: CaptureSet };
}

export interface RunIndexEntry {
  file: string;
  run_id: string;
  mode: RunMode;
  source: RunSource;
  rig: string;
  gpu: string;
  model: string;
  timestamp: string;
}

/** One file of the corpus, as shipped to the browser. */
export interface CorpusFile {
  path: string;
  language: string;
  lines: number;
  approx_tokens: number;
  text: string;
}

export interface CorpusSnapshot {
  root: string;
  prefix_sha256: string;
  prefix_chars: number;
  prefix_approx_tokens: number;
  file_count: number;
  total_lines: number;
  files: CorpusFile[];
}

/** Base path for the JSON written by scripts/sync-to-site.sh. */
export const DATA_BASE = '/spearfishing/fireworks-ai/data';
