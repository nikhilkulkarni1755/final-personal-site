import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, Play, RotateCcw, Square } from 'lucide-react';
import CodeViewer from './CodeViewer';
import FileTree from './FileTree';
import Preview from './Preview';
import { SERIES, formatMs } from './chartTokens';
import type { CaptureRequest, CaptureRun, CorpusFile } from './types';
import { useFireworksReplay } from '../../hooks/useFireworksReplay';

interface WorkbenchProps {
  run: CaptureRun;
  files: CorpusFile[];
  fileMap: Map<string, CorpusFile>;
  canonicalText: (path: string) => string;
  dirtyPaths: Set<string>;
  prefixDiverged: boolean;
  applyEdit: (path: string, text: string) => void;
  resetProject: () => void;
}

const SPEEDS = [1, 2, 4, 8];

/** Every request in the run that actually carries an edit we can replay. */
const playableRequests = (run: CaptureRun): CaptureRequest[] =>
  Object.values(run.sets)
    .flatMap((set) => set?.requests ?? [])
    .filter((request) => request.output_text && request.target_file);

/**
 * Workbench - the project, the prompt box, and what the engine does to them.
 *
 * Every edit here is local to this browser tab and is thrown away on reload.
 * That is deliberate, and it doubles as the lesson: the canonical project is the
 * prefix the engine has cached, so the moment a visitor changes a file their
 * prefix stops matching and the next request cannot hit the cache. The banner
 * says so, and Reset puts it back.
 */
const Workbench = ({
  run,
  files,
  fileMap,
  canonicalText,
  dirtyPaths,
  prefixDiverged,
  applyEdit,
  resetProject,
}: WorkbenchProps) => {
  const [selected, setSelected] = useState('frontend/style.css');
  const [pane, setPane] = useState<'code' | 'preview'>('code');

  const onStream = useCallback((path: string, text: string) => applyEdit(path, text), [applyEdit]);
  const replay = useFireworksReplay({ onStream });

  const requests = useMemo(() => playableRequests(run), [run]);

  // Follow the file the engine is currently rewriting.
  useEffect(() => {
    const target = replay.request?.target_file;
    if (target) setSelected(target);
  }, [replay.request]);

  const runRequest = (request: CaptureRequest) => {
    const target = request.target_file!;
    setSelected(target);
    if (target.startsWith('frontend/')) setPane('preview');
    replay.play(request, '');
  };

  const file = fileMap.get(selected);
  const isDirty = dirtyPaths.has(selected);

  return (
    <div className="overflow-hidden rounded-xl border border-[#001F3F]/10 bg-white dark:border-white/10 dark:bg-[#001F3F]">
      {/* prompt row */}
      <div className="border-b border-[#001F3F]/10 p-3 dark:border-white/10">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {requests.map((request) => {
            const active = replay.request?.id === request.id;
            return (
              <button
                key={request.id}
                type="button"
                onClick={() => runRequest(request)}
                disabled={replay.isPlaying}
                className={`rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors disabled:opacity-40 ${
                  active
                    ? 'border-[#001F3F] bg-[#001F3F] text-white dark:border-white dark:bg-white dark:text-[#001F3F]'
                    : 'border-[#001F3F]/15 text-[#001F3F]/75 hover:bg-[#001F3F]/[0.04] dark:border-white/15 dark:text-white/70 dark:hover:bg-white/[0.06]'
                }`}
              >
                {request.prompt}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {replay.isPlaying ? (
            <button
              type="button"
              onClick={replay.stop}
              className="flex items-center gap-1.5 rounded-md bg-[#001F3F] px-2.5 py-1 text-white dark:bg-white dark:text-[#001F3F]"
            >
              <Square className="h-3 w-3" /> stop
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-[#001F3F]/45 dark:text-white/40">
              <Play className="h-3 w-3" /> pick a prompt to replay it
            </span>
          )}

          <span className="flex items-center gap-1 text-[#001F3F]/45 dark:text-white/40">
            <Gauge className="h-3 w-3" />
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => replay.setSpeed(value)}
                className={`rounded px-1.5 tabular-nums ${
                  replay.speed === value
                    ? 'bg-[#001F3F]/10 font-semibold text-[#001F3F] dark:bg-white/15 dark:text-white'
                    : 'hover:text-[#001F3F] dark:hover:text-white'
                }`}
              >
                {value}×
              </button>
            ))}
          </span>

          {replay.request && (
            <span className="flex items-center gap-3 font-mono tabular-nums text-[#001F3F]/60 dark:text-white/55">
              <span style={{ color: SERIES.prefill }}>
                ttft {formatMs(replay.request.ttft_ms)}
                {(replay.request.cache_hit_tokens ?? 0) > 0 && ' · cache hit'}
              </span>
              <span style={{ color: SERIES.decode }}>
                {replay.tokensEmitted.toLocaleString()} / {replay.request.output_tokens.toLocaleString()} tok
              </span>
              {replay.recentItlMs > 0 && <span>{replay.recentItlMs.toFixed(1)}ms/tok</span>}
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              replay.reset();
              resetProject();
            }}
            disabled={!prefixDiverged && !replay.request}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-[#001F3F]/15 px-2.5 py-1 text-[#001F3F]/70 transition-colors hover:bg-[#001F3F]/[0.04] disabled:opacity-35 dark:border-white/15 dark:text-white/65 dark:hover:bg-white/[0.06]"
          >
            <RotateCcw className="h-3 w-3" /> reset project
          </button>
        </div>
      </div>

      {/* the divergence lesson */}
      {prefixDiverged && (
        <div className="border-b border-[#C2670A]/30 bg-[#C2670A]/[0.07] px-3 py-2 text-[11px] text-[#001F3F]/80 dark:border-[#C87A16]/30 dark:bg-[#C87A16]/[0.09] dark:text-white/75">
          <strong className="font-semibold">Your copy has diverged.</strong> These edits live only in this browser
          tab — nothing is saved anywhere. But the project is also the prompt prefix, so your next request no longer
          matches the one the engine has cached: it would pay full prefill again. Reset to get the cache hit back.
        </div>
      )}

      {/* three panes */}
      <div className="grid min-h-[420px] grid-cols-1 md:grid-cols-[180px_1fr] lg:grid-cols-[180px_1fr_320px]">
        <div className="border-b border-[#001F3F]/10 md:border-b-0 md:border-r dark:border-white/10">
          <FileTree files={files} selected={selected} dirtyPaths={dirtyPaths} onSelect={setSelected} />
        </div>

        <div className="flex min-w-0 flex-col border-b border-[#001F3F]/10 md:border-b-0 lg:border-r dark:border-white/10">
          <div className="flex items-center gap-2 border-b border-[#001F3F]/10 px-3 py-1.5 dark:border-white/10">
            <span className="truncate font-mono text-[11px] text-[#001F3F]/70 dark:text-white/65">{selected}</span>
            {isDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#F4A340]" />}
            <div className="ml-auto flex gap-1 lg:hidden">
              {(['code', 'preview'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPane(value)}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    pane === value
                      ? 'bg-[#001F3F]/10 font-medium text-[#001F3F] dark:bg-white/15 dark:text-white'
                      : 'text-[#001F3F]/50 dark:text-white/45'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className={`flex-1 ${pane === 'preview' ? 'hidden lg:block' : ''}`}>
            {file && (
              <CodeViewer
                text={file.text}
                language={file.language}
                compareTo={isDirty ? canonicalText(selected) : undefined}
                followTail={replay.isPlaying}
              />
            )}
          </div>
          <div className={`flex-1 lg:hidden ${pane === 'code' ? 'hidden' : ''}`}>
            <Preview fileMap={fileMap} />
          </div>
        </div>

        <div className="hidden min-h-[420px] lg:block">
          <Preview fileMap={fileMap} />
        </div>
      </div>
    </div>
  );
};

export default Workbench;
