import { useCallback, useState } from 'react';
import { DATA_BASE } from '../components/fireworks/types';
import { isAcceptable, parseStream, type PromptContract } from '../components/fireworks/editProtocol';

/**
 * useFireworksLive - send a prompt to the real engine and stream the edit back.
 *
 * The engine is a serverless worker that scales to zero, so there is nothing
 * to wake explicitly: the first prompt after an idle spell wakes it, and the
 * gateway reports the wait as `waking` frames inside the same SSE stream. That
 * wait is shown rather than hidden -- it is the scale-to-zero cost the writeup
 * argues about, happening in front of the reader.
 *
 * Set VITE_FIREWORKS_GATEWAY to the deployed Worker URL. With it unset the hook
 * reports itself unavailable and the page never offers the box.
 */

export type LivePhase = 'idle' | 'waking' | 'streaming' | 'done' | 'failed';

export interface LiveState {
  phase: LivePhase;
  /** Path the engine is currently writing, for following along in the editor. */
  activePath: string | null;
  /** Tokens streamed so far. */
  tokens: number;
  /** The checkpoint that answered, as the engine names it in its stream. */
  model: string | null;
  /** Milliseconds spent waiting for a worker; grows while waking, then final. */
  wakeMs: number | null;
  ttftMs: number | null;
  tpotMs: number | null;
  e2eMs: number | null;
  message: string;
}

const GATEWAY = (import.meta.env.VITE_FIREWORKS_GATEWAY as string | undefined) ?? '';
/** Public Grafana dashboard for the engine, when one is deployed. */
export const GRAFANA_URL = (import.meta.env.VITE_FIREWORKS_GRAFANA as string | undefined) ?? '';

/** What a finished prompt did, for the UI to report. */
export type PromptOutcome =
  | { kind: 'applied'; paths: string[] }
  | { kind: 'out_of_scope' }
  | { kind: 'refused'; message: string }
  | { kind: 'error'; message: string };

const IDLE: LiveState = {
  phase: 'idle',
  activePath: null,
  tokens: 0,
  model: null,
  wakeMs: null,
  ttftMs: null,
  tpotMs: null,
  e2eMs: null,
  message: '',
};

/** The frames the gateway adds to the stream; everything else is the engine's. */
interface GatewayFrame {
  phase: 'waking' | 'streaming' | 'done' | 'failed';
  elapsed_ms?: number;
  wake_ms?: number | null;
  ttft_ms?: number | null;
  tpot_ms?: number | null;
  e2e_ms?: number;
  message?: string;
}

export const useFireworksLive = () => {
  const [state, setState] = useState<LiveState>(IDLE);

  /**
   * Send a free-text prompt and stream the result into the working copy.
   *
   * The contract is enforced here, not in the model: anything that is not a
   * well-formed edit against a file that actually exists renders as "out of
   * scope" rather than reaching the page. The quota is enforced by the
   * gateway, which records the prompt against this address BEFORE calling the
   * engine -- a refusal arrives as a 429 and no inference happened.
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

      // The visitor's current working copy is the context, so a second prompt
      // sees the result of the first, which is how a real coding agent behaves.
      const projectBlob = project.files
        .map((file) => `<file path="docscribe/${file.path}">\n${file.text}\n</file>`)
        .join('\n');

      setState({ ...IDLE, phase: 'waking' });
      try {
        const response = await fetch(`${GATEWAY}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: contract.system_prompt },
              { role: 'user', content: `<project_context>\n${projectBlob}\n</project_context>\n\n${prompt}` },
            ],
            max_tokens: 4096,
            temperature: 0,
          }),
        });

        if (response.status === 429) {
          const { message } = (await response.json()) as { message: string };
          setState({ ...IDLE, phase: 'failed', message });
          return { kind: 'refused', message };
        }
        if (!response.ok || !response.body) {
          setState({ ...IDLE, phase: 'failed', message: `gateway returned ${response.status}` });
          return { kind: 'error', message: `gateway returned ${response.status}` };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let tokens = 0;
        const applied = new Set<string>();
        let failed: string | null = null;
        // A frame split across two reads waits here for its other half.
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
            try {
              const chunk = JSON.parse(payload);
              const frame = chunk.gateway as GatewayFrame | undefined;
              if (frame) {
                if (frame.phase === 'waking') setState((current) => ({ ...current, wakeMs: frame.elapsed_ms ?? 0 }));
                if (frame.phase === 'streaming') setState((current) => ({ ...current, phase: 'streaming', wakeMs: frame.wake_ms ?? 0 }));
                if (frame.phase === 'failed') failed = frame.message ?? 'engine failed';
                if (frame.phase === 'done') {
                  setState((current) => ({
                    ...current,
                    wakeMs: frame.wake_ms ?? current.wakeMs,
                    ttftMs: frame.ttft_ms ?? null,
                    tpotMs: frame.tpot_ms ?? null,
                    e2eMs: frame.e2e_ms ?? null,
                  }));
                }
                continue;
              }
              if (chunk.model) setState((current) => (current.model ? current : { ...current, model: chunk.model }));
              const delta = chunk.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                accumulated += delta;
                tokens += 1;
              }
            } catch {
              // Not JSON; the gateway never sends one, so skip it.
            }
          }

          // Stream each edit into the editor as it arrives, so the visitor
          // watches the file being written rather than waiting for a result.
          const parsed = parseStream(accumulated, allowed);
          if (parsed.outOfScope) break;
          parsed.edits.forEach((edit) => {
            project.applyEdit(edit.path, edit.text);
            applied.add(edit.path);
          });
          setState((current) => ({ ...current, tokens, activePath: parsed.activePath }));
        }

        if (failed) {
          setState((current) => ({ ...current, phase: 'failed', message: failed! }));
          return { kind: 'error', message: failed };
        }

        const final = parseStream(accumulated, allowed);
        setState((current) => ({ ...current, phase: 'done', activePath: null }));
        if (!isAcceptable(final)) {
          // Put back anything a partial stream had already written: a response
          // that fails the contract must leave no trace on the page.
          applied.forEach((path) => {
            const original = project.files.find((file) => file.path === path);
            if (original) project.applyEdit(path, original.text);
          });
          return { kind: 'out_of_scope' };
        }
        return { kind: 'applied', paths: final.edits.map((edit) => edit.path) };
      } catch (error) {
        setState({ ...IDLE, phase: 'failed', message: (error as Error).message });
        return { kind: 'error', message: (error as Error).message };
      }
    },
    [],
  );

  return {
    ...state,
    submitPrompt,
    available: Boolean(GATEWAY),
    busy: state.phase === 'waking' || state.phase === 'streaming',
  };
};

export default useFireworksLive;
