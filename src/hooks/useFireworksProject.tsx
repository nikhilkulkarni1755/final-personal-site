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
 *
 * Two states, and the distinction is deliberate:
 *
 *   canonical     the project as shipped. Byte-identical for every visitor, so
 *                 it is the one prefix worth caching, and it is the only thing
 *                 the engine is warmed with. Never modified by anyone.
 *   working copy  this visitor's edits layered on top. Theirs alone, discarded
 *                 on reload, and invisible to every other visitor.
 *
 * Iteration happens on the working copy — a second prompt sees the result of the
 * first, which is how a real coding agent behaves. What it costs is the cache:
 * once the working copy diverges, no other visitor shares that prefix, so it
 * cannot be a hit. That trade is the honest one to show, and it is why the page
 * says which state you are in rather than hiding it.
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

  /**
   * How much of the prefix survives divergence.
   *
   * The radix tree matches on a token sequence, so a hit ends at the first byte
   * that differs. Files are serialized in sorted path order, which means editing
   * `backend/agent.py` invalidates everything after it while `frontend/style.css`
   * — sorted last — costs almost nothing. Same edit, very different cache bill,
   * and worth showing rather than asserting.
   */
  const cacheableFraction = useMemo(() => {
    if (!snapshot || dirtyPaths.size === 0) return 1;
    const firstDirty = snapshot.files.findIndex((file) => dirtyPaths.has(file.path));
    if (firstDirty < 0) return 1;
    const surviving = snapshot.files
      .slice(0, firstDirty)
      .reduce((sum, file) => sum + file.approx_tokens, 0);
    return surviving / Math.max(snapshot.prefix_approx_tokens, 1);
  }, [snapshot, dirtyPaths]);

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
    /** Fraction of the shared prefix still reusable, 0..1. */
    cacheableFraction,
    loading,
    error,
  };
};

export default useFireworksProject;
