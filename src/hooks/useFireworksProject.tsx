import { useCallback, useEffect, useMemo, useState } from 'react';
import { DATA_BASE, type CorpusFile, type CorpusSnapshot } from '../components/fireworks/types';

/**
 * useFireworksProject - the visitor's own copy of the DocScribe project.
 *
 * Every edit made on this page is deliberately ephemeral. The snapshot is
 * fetched once, copied into React state, and mutated only in memory:
 *
 * - nothing is written back to any repository
 * - nothing is shared between visitors
 * - nothing is persisted, so a reload restores the canonical project
 *
 * That is not just a safety property, it is the lesson. The canonical project
 * is the prompt prefix the engine has cached. The moment a visitor edits a
 * file, their prefix diverges and the next request can no longer hit the radix
 * cache — `prefixDiverged` drives the banner that says so.
 */
const LANGUAGES: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  ts: 'javascript',
  css: 'css',
  html: 'html',
  md: 'markdown',
};

export const useFireworksProject = () => {
  const [snapshot, setSnapshot] = useState<CorpusSnapshot | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${DATA_BASE}/corpus.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json() as Promise<CorpusSnapshot>;
      })
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Canonical files with any local edits applied on top. */
  const files: CorpusFile[] = useMemo(() => {
    if (!snapshot) return [];
    const known = new Set(snapshot.files.map((file) => file.path));

    const existing = snapshot.files.map((file) => {
      const edited = edits[file.path];
      if (edited === undefined) return file;
      return { ...file, text: edited, lines: edited.split('\n').length };
    });

    // Files the engine created rather than edited — asking for tests produces a
    // new file, and it should show up in the tree like any other.
    const added = Object.entries(edits)
      .filter(([path]) => !known.has(path))
      .map(([path, text]) => ({
        path,
        language: LANGUAGES[path.split('.').pop() ?? ''] ?? '',
        lines: text.split('\n').length,
        approx_tokens: 0,
        text,
      }));

    return [...existing, ...added].sort((a, b) => a.path.localeCompare(b.path));
  }, [snapshot, edits]);

  const fileMap = useMemo(() => {
    const map = new Map<string, CorpusFile>();
    files.forEach((file) => map.set(file.path, file));
    return map;
  }, [files]);

  const canonicalText = useCallback(
    (path: string) => snapshot?.files.find((file) => file.path === path)?.text ?? '',
    [snapshot],
  );

  const applyEdit = useCallback((path: string, text: string) => {
    setEdits((current) => ({ ...current, [path]: text }));
  }, []);

  const revertFile = useCallback((path: string) => {
    setEdits((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, []);

  const resetProject = useCallback(() => setEdits({}), []);

  const dirtyPaths = useMemo(() => new Set(Object.keys(edits)), [edits]);

  return {
    snapshot,
    files,
    fileMap,
    canonicalText,
    applyEdit,
    revertFile,
    resetProject,
    dirtyPaths,
    /** True once the visitor's project no longer matches the cached prefix. */
    prefixDiverged: dirtyPaths.size > 0,
    loading,
    error,
  };
};

export default useFireworksProject;
