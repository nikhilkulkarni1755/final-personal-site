import { useEffect, useMemo, useRef } from 'react';
import { collapseContext, diffLines, diffStats, type DiffLine } from './diff';
import { TOKEN_CLASS, initialCarry, tokenizeLine, type Token } from './highlight';

interface CodeViewerProps {
  /** Current text of the file (with any streamed edit already applied). */
  text: string;
  language: string;
  /** When provided and different, the viewer renders a diff instead of the file. */
  compareTo?: string;
  /** Keep the newest change scrolled into view while a response streams. */
  followTail?: boolean;
  emptyMessage?: string;
}

const renderTokens = (tokens: Token[]) =>
  tokens.map((token, index) => (
    <span key={index} className={TOKEN_CLASS[token.type]}>
      {token.text}
    </span>
  ));

const GUTTER = 'select-none text-right pr-3 tabular-nums text-[11px] text-[#001F3F]/30 dark:text-white/25';

/**
 * CodeViewer - read-only code display with an optional line diff.
 *
 * Deliberately dependency-free: visitors never type into this pane, they type
 * prompts and the model rewrites the file, so an editor would be dead weight in
 * the portfolio's bundle. See highlight.ts for the reasoning.
 */
const CodeViewer = ({ text, language, compareTo, followTail, emptyMessage }: CodeViewerProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);

  const isDiff = compareTo !== undefined && compareTo !== text;

  const hunks = useMemo(() => {
    if (!isDiff) return null;
    return collapseContext(diffLines(compareTo!, text), 3);
  }, [isDiff, compareTo, text]);

  const stats = useMemo(() => {
    if (!isDiff) return null;
    return diffStats(diffLines(compareTo!, text));
  }, [isDiff, compareTo, text]);

  // Tokenize with carry-over so block comments and docstrings stay correct.
  const plainLines = useMemo(() => {
    if (isDiff) return null;
    const carry = initialCarry();
    return text.split('\n').map((line) => tokenizeLine(line, language, carry));
  }, [isDiff, text, language]);

  useEffect(() => {
    if (!followTail || !tailRef.current) return;
    tailRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [followTail, text]);

  if (!text && emptyMessage) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[#001F3F]/40 dark:text-white/40">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto font-mono text-[12px] leading-[1.65]">
      {isDiff && stats && (
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[#001F3F]/10 bg-white/95 px-3 py-1.5 text-[11px] backdrop-blur dark:border-white/10 dark:bg-[#001F3F]/95">
          <span className="font-sans text-[#0F7B5A] dark:text-[#7FD8AE]">+{stats.added}</span>
          <span className="font-sans text-[#B3261E] dark:text-[#F2A6A0]">−{stats.removed}</span>
          <span className="font-sans text-[#001F3F]/40 dark:text-white/40">unsaved local change</span>
        </div>
      )}

      {isDiff
        ? hunks!.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              {hunk.skippedBefore > 0 && (
                <div className="border-y border-dashed border-[#001F3F]/10 bg-[#001F3F]/[0.02] px-3 py-1 font-sans text-[11px] text-[#001F3F]/35 dark:border-white/10 dark:bg-white/[0.02] dark:text-white/30">
                  ⋯ unchanged lines
                </div>
              )}
              {hunk.lines.map((line, lineIndex) => (
                <DiffRow key={`${hunkIndex}-${lineIndex}`} line={line} language={language} />
              ))}
            </div>
          ))
        : plainLines!.map((tokens, index) => (
            <div key={index} className="flex px-1 hover:bg-[#001F3F]/[0.03] dark:hover:bg-white/[0.03]">
              <span className={`${GUTTER} w-12 shrink-0`}>{index + 1}</span>
              <code className="whitespace-pre-wrap break-words">{renderTokens(tokens)}</code>
            </div>
          ))}
      <div ref={tailRef} />
    </div>
  );
};

const ROW_STYLE: Record<DiffLine['kind'], string> = {
  context: '',
  add: 'bg-[#0F7B5A]/[0.10] dark:bg-[#7FD8AE]/[0.12]',
  delete: 'bg-[#B3261E]/[0.08] dark:bg-[#F2A6A0]/[0.10]',
};

const MARKER: Record<DiffLine['kind'], string> = { context: ' ', add: '+', delete: '−' };

const DiffRow = ({ line, language }: { line: DiffLine; language: string }) => {
  // Each diff row is tokenized standalone; block state across a collapsed hunk
  // is not meaningful, and a stray unterminated string only affects one row.
  const tokens = useMemo(() => tokenizeLine(line.text, language, initialCarry()), [line.text, language]);
  return (
    <div className={`flex px-1 ${ROW_STYLE[line.kind]}`}>
      <span className={`${GUTTER} w-10 shrink-0`}>{line.oldLine ?? ''}</span>
      <span className={`${GUTTER} w-10 shrink-0`}>{line.newLine ?? ''}</span>
      <span
        className={`w-4 shrink-0 select-none text-center ${
          line.kind === 'add'
            ? 'text-[#0F7B5A] dark:text-[#7FD8AE]'
            : line.kind === 'delete'
              ? 'text-[#B3261E] dark:text-[#F2A6A0]'
              : 'text-transparent'
        }`}
      >
        {MARKER[line.kind]}
      </span>
      <code className="whitespace-pre-wrap break-words">{renderTokens(tokens)}</code>
    </div>
  );
};

export default CodeViewer;
