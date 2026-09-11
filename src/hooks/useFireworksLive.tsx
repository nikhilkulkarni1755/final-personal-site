import { useCallback, useState } from 'react';
import { DATA_BASE } from '../components/fireworks/types';
import { OUT_OF_SCOPE, TOOL_SCHEMAS, fileTree, runTool, type PromptContract } from '../components/fireworks/tools';

/**
 * useFireworksLive - one input, one run: the agent loop, with the browser as
 * the harness.
 *
 * The visitor's working copy is the source of truth and it lives here, as
 * `{path -> text}`. The model is shown the file tree and six tools. Each turn
 * is one request through the gateway; the tool call it returns is executed
 * against the working copy in this thread, and the result goes back as the
 * next turn. The run ends when the model answers without a tool call, or the
 * turn cap is hit. Nothing server-side ever holds the code.
 *
 * The engine is a serverless worker that scales to zero, so the first turn
 * after an idle spell wakes it. The gateway reports that wait as `waking`
 * frames carrying what the backend is doing -- RunPod's worker states and the
 * engine's own boot counters -- and the page shows them. The wait is the
 * scale-to-zero cost the writeup argues about, happening in front of the
 * reader.
 *
 * Set VITE_FIREWORKS_GATEWAY to the deployed Worker URL. With it unset the hook
 * reports itself unavailable and the page never offers the box.
 */

export type LivePhase = 'idle' | 'waking' | 'thinking' | 'tool' | 'done' | 'failed';

export interface Workers {
  idle: number;
  initializing: number;
  ready: number;
  running: number;
  throttled: number;
  unhealthy: number;
}

export interface EngineSnapshot {
  heartbeat_age_s: number | null;
  startup: Record<string, number>;
  running_reqs: number | null;
  gen_throughput: number | null;
  token_usage: number | null;
}

/** One line of the run's trace: a tool call the model made, or its final word. */
export interface TraceEntry {
  turn: number;
  kind: 'tool' | 'final' | 'refused';
  /** "grep \"--bg\" → 2 matches in 1 file", or the model's closing sentence. */
  summary: string;
  ttftMs: number | null;
  cachedTokens: number | null;
  promptTokens: number | null;
}

export interface LiveState {
  phase: LivePhase;
  runId: string | null;
  turn: number;
  /** Path the last tool touched, for following along in the editor. */
  activePath: string | null;
  trace: TraceEntry[];
  /** The checkpoint that answered, as the engine names it in its stream. */
  model: string | null;
  /** Milliseconds spent waiting for a worker on turn one; grows while waking. */
  wakeMs: number | null;
  /** The visitor's time to first token on turn one, wake included. */
  ttftMs: number | null;
  tpotMs: number | null;
  /** Whole run, first send to final word. */
  e2eMs: number | null;
  /** What the backend reported during the wake, as of the last heartbeat. */
  workers: Workers | null;
  engine: EngineSnapshot | null;
  message: string;
}

const GATEWAY = (import.meta.env.VITE_FIREWORKS_GATEWAY as string | undefined) ?? '';
/** Public Grafana dashboard for the engine, when one is deployed. */
export const GRAFANA_URL = (import.meta.env.VITE_FIREWORKS_GRAFANA as string | undefined) ?? '';

/** Must match the trigger in the migration and the gateway. */
export const TURN_CAP = 12;

/** What a finished run did, for the UI to report. */
export type PromptOutcome =
  | { kind: 'applied'; paths: string[]; summary: string }
  | { kind: 'no_change'; summary: string }
  | { kind: 'out_of_scope' }
  | { kind: 'refused'; message: string }
  | { kind: 'error'; message: string };

const IDLE: LiveState = {
  phase: 'idle',
  runId: null,
  turn: 0,
  activePath: null,
  trace: [],
  model: null,
  wakeMs: null,
  ttftMs: null,
  tpotMs: null,
  e2eMs: null,
  workers: null,
  engine: null,
  message: '',
};

interface GatewayFrame {
  phase: 'accepted' | 'waking' | 'streaming' | 'done' | 'failed';
  run_id?: string;
  elapsed_ms?: number;
  workers?: Workers | null;
  engine?: EngineSnapshot | null;
  wake_ms?: number | null;
  ttft_ms?: number | null;
  tpot_ms?: number | null;
  e2e_ms?: number;
  prompt_tokens?: number | null;
  cached_tokens?: number | null;
  message?: string;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** One model turn, as the OpenAI stream delivers it. */
interface TurnResult {
  runId: string | null;
  content: string;
  toolCalls: ToolCall[];
  frame: GatewayFrame | null;
  failed: string | null;
}

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

const pathOf = (rawArgs: string): string => {
  try {
    return String(JSON.parse(rawArgs).path ?? '');
  } catch {
    return '';
  }
};

export const useFireworksLive = () => {
  const [state, setState] = useState<LiveState>(IDLE);

  /** Send one turn and read its stream, feeding wake frames into state as they arrive. */
  const sendTurn = useCallback(async (messages: Message[], runId: string | null, turn: number): Promise<TurnResult | { refused: string }> => {
    const response = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, tools: TOOL_SCHEMAS, tool_choice: 'auto', max_tokens: 2048, temperature: 0, run_id: runId ?? undefined, turn }),
    });
    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => ({}))) as { message?: string };
      return { refused: detail.message ?? `gateway returned ${response.status}` };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const result: TurnResult = { runId, content: '', toolCalls: [], frame: null, failed: null };
    let pending = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (pending + decoder.decode(value, { stream: true })).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        const frame = chunk.gateway as GatewayFrame | undefined;
        if (frame) {
          if (frame.phase === 'accepted' && frame.run_id) {
            result.runId = frame.run_id;
            setState((current) => ({ ...current, runId: frame.run_id!, turn }));
          }
          if (frame.phase === 'waking') {
            setState((current) => ({ ...current, phase: 'waking', wakeMs: frame.elapsed_ms ?? 0, workers: frame.workers ?? current.workers, engine: frame.engine ?? current.engine }));
          }
          if (frame.phase === 'streaming') setState((current) => ({ ...current, phase: 'thinking', wakeMs: turn === 1 ? (frame.wake_ms ?? 0) : current.wakeMs }));
          if (frame.phase === 'failed') result.failed = frame.message ?? 'engine failed';
          if (frame.phase === 'done') result.frame = frame;
          continue;
        }
        if (chunk.model) setState((current) => (current.model ? current : { ...current, model: chunk.model }));
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) result.content += delta.content;
        for (const call of delta?.tool_calls ?? []) {
          const index = Number(call.index ?? 0);
          const existing = (result.toolCalls[index] ??= { id: '', name: '', arguments: '' });
          if (call.id) existing.id = call.id;
          if (call.function?.name) existing.name += call.function.name;
          if (call.function?.arguments) existing.arguments += call.function.arguments;
        }
      }
    }
    return result;
  }, []);

  /**
   * One input, one run. Returns what happened so the page can say it.
   *
   * The quota is enforced by the gateway, which records the run against this
   * address BEFORE calling the engine; a refusal arrives as a 429 and no
   * inference happened. The turn cap is enforced there too.
   */
  const submitPrompt = useCallback(
    async (
      prompt: string,
      project: { files: Array<{ path: string; text: string }>; applyEdit: (path: string, text: string) => void },
    ): Promise<PromptOutcome> => {
      if (!GATEWAY) return { kind: 'error', message: 'no gateway configured' };

      let contract: PromptContract;
      try {
        contract = (await (await fetch(`${DATA_BASE}/prompt_contract.json`)).json()) as PromptContract;
      } catch {
        return { kind: 'error', message: 'could not load the prompt contract' };
      }
      const allowed = new Set(contract.allowed_paths);

      // This run's view of the working copy. Edits land here synchronously and
      // in React state via applyEdit, so a second edit in the same run sees the
      // first without waiting for a render. The model sees only the tree at first.
      const working = new Map(project.files.map((file) => [file.path, file.text]));
      const files = () => [...working].map(([path, text]) => ({ path, text }));
      const messages: Message[] = [
        { role: 'system', content: contract.agent_system_prompt },
        { role: 'user', content: `<file_tree>\n${fileTree(files())}\n</file_tree>\n\n${prompt}` },
      ];

      const started = Date.now();
      const touched = new Set<string>();
      let runId: string | null = null;
      setState({ ...IDLE, phase: 'waking' });

      const finish = (outcome: PromptOutcome, contractOutcome: 'applied' | 'out_of_scope' | 'no_change' | 'failed') => {
        setState((current) => ({
          ...current,
          phase: outcome.kind === 'error' || outcome.kind === 'refused' ? 'failed' : 'done',
          activePath: null,
          e2eMs: Date.now() - started,
          message: 'message' in outcome ? outcome.message : '',
        }));
        // Tell the gateway what the browser did with the run: the one signal
        // of contract compliance nothing server-side can see.
        if (runId) {
          void fetch(`${GATEWAY}/runs/${runId}/outcome`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contract_outcome: contractOutcome, paths: [...touched] }),
          }).catch(() => {});
        }
        return outcome;
      };

      try {
        for (let turn = 1; turn <= TURN_CAP; turn += 1) {
          setState((current) => ({ ...current, turn }));
          const result = await sendTurn(messages, runId, turn);
          if ('refused' in result) return finish({ kind: 'refused', message: result.refused }, 'failed');
          if (result.failed) return finish({ kind: 'error', message: result.failed }, 'failed');
          runId = result.runId;
          const frame = result.frame;
          const entryTimings = { ttftMs: frame?.ttft_ms ?? null, cachedTokens: frame?.cached_tokens ?? null, promptTokens: frame?.prompt_tokens ?? null };
          if (turn === 1 && frame) setState((current) => ({ ...current, ttftMs: frame.ttft_ms ?? null, tpotMs: frame.tpot_ms ?? null }));

          // No tool call: the model is done, one way or another.
          if (!result.toolCalls.length) {
            const text = result.content.trim();
            if (text.toUpperCase().startsWith(OUT_OF_SCOPE)) {
              setState((current) => ({ ...current, trace: [...current.trace, { turn, kind: 'final', summary: 'out of scope', ...entryTimings }] }));
              return finish({ kind: 'out_of_scope' }, 'out_of_scope');
            }
            const summary = text.slice(0, 300) || (touched.size ? 'done' : 'no change made');
            setState((current) => ({ ...current, trace: [...current.trace, { turn, kind: 'final', summary, ...entryTimings }] }));
            return touched.size
              ? finish({ kind: 'applied', paths: [...touched], summary }, 'applied')
              : finish({ kind: 'no_change', summary }, 'no_change');
          }

          // Execute each call against the working copy, in the page's own thread.
          messages.push({
            role: 'assistant',
            content: result.content || null,
            tool_calls: result.toolCalls.map((call, index) => ({ id: call.id || `call_${turn}_${index}`, type: 'function', function: { name: call.name, arguments: call.arguments } })),
          });
          result.toolCalls.forEach((call, index) => {
            const outcome = runTool(call.name, call.arguments, files(), allowed);
            if (outcome.edit) {
              working.set(outcome.edit.path, outcome.edit.text);
              project.applyEdit(outcome.edit.path, outcome.edit.text);
              touched.add(outcome.edit.path);
            }
            const path = outcome.edit?.path ?? pathOf(call.arguments);
            setState((current) => ({
              ...current,
              phase: 'tool',
              activePath: allowed.has(path) ? path : current.activePath,
              trace: [...current.trace, { turn, kind: outcome.refused ? 'refused' : 'tool', summary: outcome.summary, ...entryTimings }],
            }));
            messages.push({ role: 'tool', tool_call_id: call.id || `call_${turn}_${index}`, content: outcome.content });
          });
          setState((current) => ({ ...current, phase: 'thinking' }));
        }
        return finish({ kind: 'error', message: `The model used all ${TURN_CAP} turns without finishing.` }, 'failed');
      } catch (error) {
        return finish({ kind: 'error', message: (error as Error).message }, 'failed');
      }
    },
    [sendTurn],
  );

  return {
    ...state,
    submitPrompt,
    available: Boolean(GATEWAY),
    busy: state.phase === 'waking' || state.phase === 'thinking' || state.phase === 'tool',
  };
};

export default useFireworksLive;
