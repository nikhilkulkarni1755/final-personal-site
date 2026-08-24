import { useCallback, useEffect, useRef, useState } from 'react';
import { DATA_BASE } from '../components/fireworks/types';
import { isAcceptable, parseStream, type PromptContract } from '../components/fireworks/editProtocol';

/**
 * useFireworksLive - the gated "wake a real GPU" path.
 *
 * The page is fully functional without this. Everything on it replays captures
 * that were recorded against a real engine, so the live path proves the numbers
 * are reproducible rather than making them viewable — which is why every failure
 * here is allowed to be blunt, and why the fallback is simply "keep replaying".
 *
 * Set VITE_FIREWORKS_GATEWAY to the deployed Worker URL. With it unset the hook
 * reports itself unavailable and the page never offers the control.
 */

export type LiveState = 'unavailable' | 'idle' | 'starting' | 'ready' | 'stopping' | 'expired' | 'failed';

export interface LiveStatus {
  state: LiveState;
  podId: string | null;
  gpu: string | null;
  secondsRemaining: number | null;
  costPerHour: number | null;
  message: string;
}

const GATEWAY = (import.meta.env.VITE_FIREWORKS_GATEWAY as string | undefined) ?? '';
const POLL_MS = 4000;

/** What a finished prompt did, for the UI to report. */
export type PromptOutcome =
  | { kind: 'applied'; paths: string[] }
  | { kind: 'out_of_scope' }
  | { kind: 'error'; message: string };

const IDLE: LiveStatus = {
  state: GATEWAY ? 'idle' : 'unavailable',
  podId: null,
  gpu: null,
  secondsRemaining: null,
  costPerHour: null,
  message: '',
};

export const useFireworksLive = () => {
  const [status, setStatus] = useState<LiveStatus>(IDLE);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const refresh = useCallback(async (): Promise<LiveStatus | null> => {
    if (!GATEWAY) return null;
    try {
      const response = await fetch(`${GATEWAY}/status`);
      const payload = (await response.json()) as LiveStatus;
      setStatus(payload);
      return payload;
    } catch {
      // The gateway being unreachable is not an error worth shouting about:
      // the page keeps replaying, which is what it does by default anyway.
      setStatus((current) => ({ ...current, state: 'unavailable' }));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!GATEWAY) return;
    void refresh();
    return stopPolling;
  }, [refresh, stopPolling]);

  /** Poll while a lease is live, so the countdown is real rather than local. */
  useEffect(() => {
    if (status.state !== 'starting' && status.state !== 'ready') {
      stopPolling();
      return;
    }
    if (timer.current !== null) return;
    timer.current = window.setInterval(() => void refresh(), POLL_MS);
    return stopPolling;
  }, [status.state, refresh, stopPolling]);

  const start = useCallback(
    async (credentials: { email?: string; token?: string }) => {
      if (!GATEWAY) return;
      setBusy(true);
      try {
        const response = await fetch(`${GATEWAY}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        });
        setStatus((await response.json()) as LiveStatus);
      } catch (error) {
        setStatus({ ...IDLE, state: 'failed', message: (error as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    if (!GATEWAY) return;
    setBusy(true);
    try {
      const response = await fetch(`${GATEWAY}/stop`, { method: 'DELETE' });
      setStatus((await response.json()) as LiveStatus);
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Send a free-text prompt and stream the result into the working copy.
   *
   * Two things make this safe to point at an untrusted box. The contract is
   * enforced here, not in the model: anything that is not a well-formed edit
   * against a file that actually exists renders as "out of scope" rather than
   * reaching the page. And the quota row is written BEFORE the request goes
   * out, so a refused write means no inference happens -- the alternative
   * charges for work and then discovers it was over the limit.
   */
  const submitPrompt = useCallback(
    async (
      prompt: string,
      project: { files: Array<{ path: string; text: string }>; applyEdit: (path: string, text: string) => void },
      quota: { consume: (prompt: string) => Promise<boolean> },
    ): Promise<PromptOutcome> => {
      if (!GATEWAY) return { kind: 'error', message: 'no gateway configured' };

      if (!(await quota.consume(prompt))) {
        return { kind: 'error', message: 'Could not record this prompt against your quota, so it was not sent.' };
      }

      let contract: PromptContract;
      try {
        contract = (await (await fetch(`${DATA_BASE}/prompt_contract.json`)).json()) as PromptContract;
      } catch {
        return { kind: 'error', message: 'could not load the prompt contract' };
      }
      const allowed = new Set(contract.allowed_paths);

      // The visitor's current working copy is the context, so a second prompt
      // sees the result of the first -- and so an edited project genuinely
      // diverges from the cached prefix, which is the lesson the page teaches.
      const projectBlob = project.files
        .map((file) => `<file path="docscribe/${file.path}">\n${file.text}\n</file>`)
        .join('\n');

      setBusy(true);
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
            stream: true,
          }),
        });

        if (!response.ok || !response.body) {
          return { kind: 'error', message: `engine returned ${response.status}` };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let applied = new Set<string>();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payload);
              accumulated += chunk.choices?.[0]?.delta?.content ?? '';
            } catch {
              // A partial SSE frame; the next read completes it.
            }
          }

          // Stream each edit into the editor as it arrives, so the visitor
          // watches the file being written rather than waiting for a result.
          const state = parseStream(accumulated, allowed);
          if (state.outOfScope) break;
          state.edits.forEach((edit) => {
            project.applyEdit(edit.path, edit.text);
            applied.add(edit.path);
          });
        }

        const final = parseStream(accumulated, allowed);
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
        return { kind: 'error', message: (error as Error).message };
      } finally {
        setBusy(false);
        void refresh();
      }
    },
    [refresh],
  );

  return {
    ...status,
    busy,
    submitPrompt,
    available: Boolean(GATEWAY),
    isLive: status.state === 'ready',
    start,
    stop,
    refresh,
  };
};

export default useFireworksLive;
