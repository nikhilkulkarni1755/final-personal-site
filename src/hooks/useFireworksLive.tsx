import { useCallback, useEffect, useRef, useState } from 'react';

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

  return {
    ...status,
    busy,
    available: Boolean(GATEWAY),
    isLive: status.state === 'ready',
    start,
    stop,
    refresh,
  };
};

export default useFireworksLive;
