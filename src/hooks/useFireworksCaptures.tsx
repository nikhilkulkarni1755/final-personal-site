import { useEffect, useMemo, useState } from 'react';
import { DATA_BASE, type CaptureRun, type RunIndexEntry, type RunMode } from '../components/fireworks/types';

/**
 * useFireworksCaptures - load the measurement runs the page renders.
 *
 * The page displays nothing it cannot trace to one of these files. Runs are
 * fetched from an index written by scripts/sync-to-site.sh, so filenames are
 * never guessed here.
 *
 * Runs from different rigs must never be compared. `activePair` therefore only
 * ever returns a colocated/disaggregated pair captured on the same rig — if no
 * such pair exists, the comparison toggle is disabled rather than misleading.
 */
export const useFireworksCaptures = () => {
  const [runs, setRuns] = useState<CaptureRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RunMode>('disaggregated');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const indexResponse = await fetch(`${DATA_BASE}/index.json`);
      if (!indexResponse.ok) throw new Error(`index.json: ${indexResponse.status}`);
      const { runs: entries } = (await indexResponse.json()) as { runs: RunIndexEntry[] };

      const loaded = await Promise.all(
        entries.map(async (entry) => {
          const response = await fetch(`${DATA_BASE}/${entry.file}`);
          if (!response.ok) throw new Error(`${entry.file}: ${response.status}`);
          return (await response.json()) as CaptureRun;
        }),
      );
      if (!cancelled) {
        setRuns(loaded);
        setLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (cancelled) return;
      setError(err.message);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /** The newest rig that has BOTH modes captured, so the toggle is honest. */
  const activePair = useMemo(() => {
    const byRig = new Map<string, Partial<Record<RunMode, CaptureRun>>>();
    runs.forEach((run) => {
      const bucket = byRig.get(run.rig.label) ?? {};
      const existing = bucket[run.mode];
      if (!existing || run.timestamp > existing.timestamp) bucket[run.mode] = run;
      byRig.set(run.rig.label, bucket);
    });

    const complete = [...byRig.entries()].filter(([, bucket]) => bucket.colocated && bucket.disaggregated);
    if (!complete.length) return null;
    // Prefer measured pairs over synthetic ones, then the most recent.
    complete.sort(([, a], [, b]) => {
      const score = (bucket: Partial<Record<RunMode, CaptureRun>>) =>
        bucket.disaggregated?.source === 'measured' ? 1 : 0;
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return (b.disaggregated?.timestamp ?? '').localeCompare(a.disaggregated?.timestamp ?? '');
    });
    const [, bucket] = complete[0];
    return { colocated: bucket.colocated!, disaggregated: bucket.disaggregated! };
  }, [runs]);

  const active = activePair ? activePair[mode] : (runs[0] ?? null);
  const other = activePair ? activePair[mode === 'disaggregated' ? 'colocated' : 'disaggregated'] : null;

  return {
    runs,
    active,
    other,
    activePair,
    mode,
    setMode,
    canCompare: activePair !== null,
    loading,
    error,
  };
};

export default useFireworksCaptures;
