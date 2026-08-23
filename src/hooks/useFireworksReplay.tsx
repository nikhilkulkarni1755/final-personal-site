import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureRequest } from '../components/fireworks/types';

export type ReplayPhase = 'idle' | 'prefill' | 'decode' | 'done';

export interface ReplayState {
  request: CaptureRequest | null;
  phase: ReplayPhase;
  /** Virtual milliseconds since the request was issued. */
  elapsedMs: number;
  tokensEmitted: number;
  /** Rolling inter-token latency over the last few tokens, in ms. */
  recentItlMs: number;
}

const IDLE: ReplayState = { request: null, phase: 'idle', elapsedMs: 0, tokensEmitted: 0, recentItlMs: 0 };

/**
 * Split text into atoms that line up with the engine's token count.
 *
 * capture/blob.py counts tokens with /[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/, so
 * splitting on the same classes — but keeping whitespace as its own atom —
 * gives us pieces that map nearly one-to-one onto the recorded itl_ms array.
 */
const atomize = (text: string): string[] => text.match(/[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/g) ?? [];

interface ReplayOptions {
  /** Called with the partially-streamed text on every frame that advances. */
  onStream: (path: string, text: string) => void;
}

/**
 * useFireworksReplay - replay a recorded request as if it were happening now.
 *
 * A capture stores the real time-to-first-token and one inter-token latency per
 * emitted token, so replaying it against a virtual clock reproduces the original
 * cadence exactly: the same pause before the first token, the same stutter when
 * a colocated decode was stalled behind someone else's prefill. That is the
 * point of replaying rather than animating — the rhythm carries information.
 *
 * Playback speed is explicit and surfaced in the UI. It never silently
 * compresses time, because the timing is the evidence.
 */
export const useFireworksReplay = ({ onStream }: ReplayOptions) => {
  const [state, setState] = useState<ReplayState>(IDLE);
  const [speed, setSpeed] = useState(1);

  const frameRef = useRef<number | null>(null);
  const speedRef = useRef(speed);
  const streamRef = useRef(onStream);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    streamRef.current = onStream;
  }, [onStream]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    (request: CaptureRequest, baseText: string) => {
      stop();

      const target = request.target_file;
      const full = request.output_text ?? '';
      const atoms = atomize(full);
      // Cumulative virtual time at which each atom lands.
      const schedule: number[] = [];
      let clock = request.ttft_ms;
      let tokenIndex = 0;
      atoms.forEach((atom) => {
        schedule.push(clock);
        if (!/^\s+$/.test(atom)) {
          clock += request.itl_ms[Math.min(tokenIndex, request.itl_ms.length - 1)] ?? 0;
          tokenIndex += 1;
        }
      });

      setState({ request, phase: 'prefill', elapsedMs: 0, tokensEmitted: 0, recentItlMs: 0 });
      if (target && full) streamRef.current(target, baseText);

      let virtual = 0;
      let last = performance.now();
      let cursor = 0;

      const step = (now: number) => {
        virtual += (now - last) * speedRef.current;
        last = now;

        let advanced = false;
        while (cursor < atoms.length && schedule[cursor] <= virtual) {
          cursor += 1;
          advanced = true;
        }

        if (advanced && target) streamRef.current(target, atoms.slice(0, cursor).join(''));

        const done = cursor >= atoms.length;
        const emitted = atoms.slice(0, cursor).filter((atom) => !/^\s+$/.test(atom)).length;
        const window = request.itl_ms.slice(Math.max(0, emitted - 12), emitted);
        setState({
          request,
          phase: done ? 'done' : virtual < request.ttft_ms ? 'prefill' : 'decode',
          elapsedMs: virtual,
          tokensEmitted: emitted,
          recentItlMs: window.length ? window.reduce((sum, value) => sum + value, 0) / window.length : 0,
        });

        if (done) {
          frameRef.current = null;
          return;
        }
        frameRef.current = requestAnimationFrame(step);
      };

      frameRef.current = requestAnimationFrame(step);
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setState(IDLE);
  }, [stop]);

  return { ...state, speed, setSpeed, play, stop, reset, isPlaying: state.phase === 'prefill' || state.phase === 'decode' };
};

export default useFireworksReplay;
