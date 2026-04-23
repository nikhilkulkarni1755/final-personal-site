import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePageAnalytics } from '../hooks/usePageAnalytics';
import ActiveViewers from '../components/ActiveViewers';
import PageStats from '../components/PageStats';
import LikeButton from '../components/LikeButton';

// ─── Reusable Sub-Components ───

const MathBlock = ({ label, variant = 'purple', children }: { label: string; variant?: 'purple' | 'green' | 'pink' | 'yellow'; children: React.ReactNode }) => {
  const borderColors = { purple: 'border-l-[#7c6aff]', green: 'border-l-[#6affe0]', pink: 'border-l-[#ff6a9a]', yellow: 'border-l-[#ffc96a]' };
  const labelBgs = { purple: 'bg-[#7c6aff]', green: 'bg-[#6affe0]', pink: 'bg-[#ff6a9a]', yellow: 'bg-[#ffc96a]' };
  return (
    <div className={`relative bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] border-l-[3px] ${borderColors[variant]} rounded-lg p-6 my-6 font-['DM_Mono',monospace] text-[0.95rem] overflow-x-auto`}>
      <span className={`absolute -top-px right-3 text-[0.6rem] tracking-[0.15em] uppercase ${labelBgs[variant]} text-black px-2 py-0.5 rounded-b font-medium`}>{label}</span>
      <pre className="whitespace-pre-wrap text-[#001F3F] dark:text-[#e8e8f0]">{children}</pre>
    </div>
  );
};

const Callout = ({ type, children }: { type: 'insight' | 'warning' | 'gpu'; children: React.ReactNode }) => {
  const styles = {
    insight: { bg: 'bg-[#7c6aff]/5 dark:bg-[#7c6aff]/[0.08]', border: 'border-[#7c6aff]', prefix: '💡 Key Insight — ', color: 'text-[#7c6aff]' },
    warning: { bg: 'bg-[#ff6a9a]/5 dark:bg-[#ff6a9a]/[0.08]', border: 'border-[#ff6a9a]', prefix: '⚡ Important — ', color: 'text-[#ff6a9a]' },
    gpu: { bg: 'bg-[#6affe0]/5 dark:bg-[#6affe0]/[0.08]', border: 'border-[#6affe0]', prefix: '🖥 Hardware — ', color: 'text-[#6affe0]' },
  };
  const s = styles[type];
  return (
    <div className={`rounded-[10px] p-5 my-6 border-l-[3px] ${s.bg} ${s.border}`}>
      <span className={`font-semibold ${s.color} text-[0.85rem] tracking-wide`}>{s.prefix}</span>
      <span className="text-[#001F3F] dark:text-[#e8e8f0]">{children}</span>
    </div>
  );
};

const SectionTag = ({ children }: { children: React.ReactNode }) => (
  <div className="font-['DM_Mono',monospace] text-[0.65rem] tracking-[0.3em] uppercase text-[#7c6aff] mb-4 flex items-center gap-3">
    {children}
    <span className="flex-1 h-px bg-gradient-to-r from-[#7c6aff] to-transparent opacity-30" />
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-['Playfair_Display',serif] text-[clamp(2rem,5vw,3.2rem)] font-bold leading-tight mb-6 text-[#001F3F] dark:text-[#e8e8f0]">{children}</h2>
);

const SectionSubtitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="font-['Playfair_Display',serif] text-2xl font-bold mt-10 mb-4 text-[#5a9a8a] dark:text-[#6affe0]">{children}</h3>
);

const Lead = ({ children }: { children: React.ReactNode }) => (
  <p className="text-lg text-[#001F3F] dark:text-[#e8e8f0] leading-relaxed mb-5">{children}</p>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[#4a4a6a] dark:text-[#9090b0] mb-5 text-base leading-relaxed">{children}</p>
);

const Strong = ({ children }: { children: React.ReactNode }) => (
  <strong className="text-[#001F3F] dark:text-[#e8e8f0] font-medium">{children}</strong>
);

const ArchDiagram = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col items-center gap-0 my-8 mx-auto max-w-[500px]">{children}</div>
);

const ArchBlock = ({ variant, label, desc }: { variant?: 'accent' | 'green' | 'pink' | 'yellow'; label: string; desc: string }) => {
  const base = 'w-full py-3 px-6 border rounded-lg text-center font-["DM_Mono",monospace] text-[0.8rem] transition-all hover:border-[#7c6aff] hover:bg-[#7c6aff]/[0.15] dark:hover:bg-[#7c6aff]/[0.15]';
  const variants: Record<string, string> = {
    accent: 'border-[#7c6aff] bg-[#7c6aff]/10 text-[#7c6aff]',
    green: 'border-[#6affe0] bg-[#6affe0]/[0.08] text-[#5a9a8a] dark:text-[#6affe0]',
    pink: 'border-[#ff6a9a] bg-[#ff6a9a]/[0.08] text-[#ff6a9a]',
    yellow: 'border-[#ffc96a] bg-[#ffc96a]/[0.08] text-[#b8860b] dark:text-[#ffc96a]',
  };
  const defaultStyle = 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#10101a] text-[#001F3F] dark:text-[#e8e8f0]';
  return (
    <div className={`${base} ${variant ? variants[variant] : defaultStyle}`}>
      {label}
      <div className="font-['DM_Sans',sans-serif] text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0] mt-0.5">{desc}</div>
    </div>
  );
};

const ArchArrow = () => (
  <div className="relative w-0.5 h-7 bg-gradient-to-b from-[#7c6aff] to-transparent">
    <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[#7c6aff] text-[0.6rem]">▼</span>
  </div>
);

const FlowDiagram = ({ children, vertical }: { children: React.ReactNode; vertical?: boolean }) => (
  <div className={`flex ${vertical ? 'flex-col items-stretch' : 'items-center flex-wrap justify-center'} gap-2 my-6 p-5 bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-lg`}>
    {children}
  </div>
);

const FlowBox = ({ variant, children }: { variant?: 'hi' | 'hi2' | 'hi3'; children: React.ReactNode }) => {
  const variants: Record<string, string> = {
    hi: 'border-[#7c6aff] text-[#7c6aff] bg-[#7c6aff]/[0.15]',
    hi2: 'border-[#6affe0] text-[#5a9a8a] dark:text-[#6affe0] bg-[#6affe0]/[0.08]',
    hi3: 'border-[#ffc96a] text-[#b8860b] dark:text-[#ffc96a] bg-[#ffc96a]/[0.08]',
  };
  const defaultStyle = 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#16162a] text-[#6a6a8a] dark:text-[#9090b0]';
  return (
    <div className={`px-4 py-2 border rounded-md font-['DM_Mono',monospace] text-[0.75rem] text-center ${variant ? variants[variant] : defaultStyle}`}>
      {children}
    </div>
  );
};

const FlowArrow = ({ vertical }: { vertical?: boolean }) => (
  <span className="text-[#6a6a8a] dark:text-[#9090b0] text-base text-center">{vertical ? '↓' : '→'}</span>
);

const Cell = ({ children, highlight, resultHighlight, style }: { children: React.ReactNode; highlight?: boolean; resultHighlight?: boolean; style?: React.CSSProperties }) => {
  let cls = 'w-11 h-11 flex items-center justify-center font-["DM_Mono",monospace] text-[0.9rem] rounded-md border transition-all duration-300 ';
  if (highlight) cls += 'bg-[#7c6aff]/25 border-[#7c6aff] text-[#7c6aff] ';
  else if (resultHighlight) cls += 'bg-[#6affe0]/20 border-[#6affe0] text-[#5a9a8a] dark:text-[#6affe0] ';
  else cls += 'bg-[#eeeef4] dark:bg-[#16162a] border-[#d0d0e0] dark:border-[#2a2a45] text-[#001F3F] dark:text-[#e8e8f0] ';
  return <div className={cls} style={style}>{children}</div>;
};

const Matrix = ({ children }: { children: React.ReactNode }) => (
  <div className="inline-flex flex-col gap-1 relative py-2 mx-[18px]">
    <span className="absolute top-0 bottom-0 left-[-10px] w-[6px] border-2 border-r-0 border-[#6a6a8a] dark:border-[#9090b0] rounded-l-[3px]" />
    <span className="absolute top-0 bottom-0 right-[-10px] w-[6px] border-2 border-l-0 border-[#6a6a8a] dark:border-[#9090b0] rounded-r-[3px]" />
    {children}
  </div>
);

const MatrixRowCells = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-1">{children}</div>
);

const CompareTable = ({ headers, rows }: { headers: string[]; rows: string[][] }) => (
  <div className="overflow-x-auto my-6">
    <table className="w-full border-collapse text-[0.9rem]">
      <thead>
        <tr>
          {headers.map(h => (
            <th key={h} className="font-['DM_Mono',monospace] text-[0.7rem] tracking-[0.15em] uppercase p-3 text-left bg-[#f0f0f8] dark:bg-[#10101a] border-b-2 border-[#d0d0e0] dark:border-[#2a2a45] text-[#7c6aff]">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="hover:bg-[#f4f4fa] dark:hover:bg-[#10101a]">
            {row.map((cell, j) => (
              <td key={j} className={`p-3 border-b border-[#d0d0e0] dark:border-[#2a2a45] align-top ${j === 0 ? 'text-[#001F3F] dark:text-[#e8e8f0] font-medium' : 'text-[#6a6a8a] dark:text-[#9090b0]'}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Interactive: MatMul Animation ───

const A_DATA = [[1, 2, 3], [4, 5, 6]];
const B_DATA = [[7, 8], [9, 10], [11, 12]];
const C_DATA = [[58, 64], [139, 154]];

const MATMUL_STEPS = [
  { row: 0, col: 0, aIds: [0, 1, 2], bIds: [0, 2, 4], expr: '1×7 + 2×9 + 3×11 = 58' },
  { row: 0, col: 1, aIds: [0, 1, 2], bIds: [1, 3, 5], expr: '1×8 + 2×10 + 3×12 = 64' },
  { row: 1, col: 0, aIds: [3, 4, 5], bIds: [0, 2, 4], expr: '4×7 + 5×9 + 6×11 = 139' },
  { row: 1, col: 1, aIds: [3, 4, 5], bIds: [1, 3, 5], expr: '4×8 + 5×10 + 6×12 = 154' },
];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const MatMulAnimation = () => {
  const [highlightA, setHighlightA] = useState<Set<number>>(new Set());
  const [highlightB, setHighlightB] = useState<Set<number>>(new Set());
  const [resultCells, setResultCells] = useState<Record<string, number | null>>({ '00': null, '01': null, '10': null, '11': null });
  const [resultHighlight, setResultHighlight] = useState<string | null>(null);
  const [explain, setExplain] = useState('Click Animate to see each dot product computed step by step.');
  const [btnText, setBtnText] = useState('▶ Animate');
  const running = useRef(false);

  const runAnim = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBtnText('⏸');
    setResultCells({ '00': null, '01': null, '10': null, '11': null });
    setResultHighlight(null);

    for (const step of MATMUL_STEPS) {
      setHighlightA(new Set(step.aIds));
      setHighlightB(new Set(step.bIds));
      setResultHighlight(null);
      setExplain(`C[${step.row}][${step.col}] = ${step.expr}`);
      await sleep(1200);
      const key = `${step.row}${step.col}`;
      setResultCells(prev => ({ ...prev, [key]: C_DATA[step.row][step.col] }));
      setResultHighlight(key);
      await sleep(600);
    }
    setHighlightA(new Set());
    setHighlightB(new Set());
    setExplain('Done! Result matrix C = [[58, 64], [139, 154]]');
    setBtnText('↺ Replay');
    running.current = false;
  }, []);

  const aFlat = A_DATA.flat();
  const bFlat = B_DATA.flat();

  return (
    <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl overflow-hidden my-8">
      <div className="bg-[#e8e8f0] dark:bg-[#16162a] px-6 py-4 border-b border-[#d0d0e0] dark:border-[#2a2a45] flex items-center justify-between">
        <span className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.15em] uppercase text-[#7c6aff]">Interactive · 2×3 times 3×2</span>
        <button onClick={runAnim} className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.1em] uppercase px-5 py-2 border border-[#7c6aff] rounded-md bg-transparent text-[#7c6aff] cursor-pointer hover:bg-[#7c6aff]/[0.15] transition-all">{btnText}</button>
      </div>
      <div className="p-6">
        <div className="flex items-center gap-6 flex-wrap justify-center mb-6">
          <div className="text-center">
            <div className="font-['DM_Mono',monospace] text-[0.65rem] text-[#6a6a8a] dark:text-[#9090b0] mb-2">A (2×3)</div>
            <Matrix>
              <MatrixRowCells>{aFlat.slice(0, 3).map((v, i) => <Cell key={i} highlight={highlightA.has(i)}>{v}</Cell>)}</MatrixRowCells>
              <MatrixRowCells>{aFlat.slice(3, 6).map((v, i) => <Cell key={i + 3} highlight={highlightA.has(i + 3)}>{v}</Cell>)}</MatrixRowCells>
            </Matrix>
          </div>
          <span className="font-['Playfair_Display',serif] text-3xl text-[#ff6a9a]">×</span>
          <div className="text-center">
            <div className="font-['DM_Mono',monospace] text-[0.65rem] text-[#6a6a8a] dark:text-[#9090b0] mb-2">B (3×2)</div>
            <Matrix>
              <MatrixRowCells>{bFlat.slice(0, 2).map((v, i) => <Cell key={i} highlight={highlightB.has(i)}>{v}</Cell>)}</MatrixRowCells>
              <MatrixRowCells>{bFlat.slice(2, 4).map((v, i) => <Cell key={i + 2} highlight={highlightB.has(i + 2)}>{v}</Cell>)}</MatrixRowCells>
              <MatrixRowCells>{bFlat.slice(4, 6).map((v, i) => <Cell key={i + 4} highlight={highlightB.has(i + 4)}>{v}</Cell>)}</MatrixRowCells>
            </Matrix>
          </div>
          <span className="font-['Playfair_Display',serif] text-3xl text-[#ff6a9a]">=</span>
          <div className="text-center">
            <div className="font-['DM_Mono',monospace] text-[0.65rem] text-[#6a6a8a] dark:text-[#9090b0] mb-2">C (2×2)</div>
            <Matrix>
              <MatrixRowCells>
                <Cell resultHighlight={resultHighlight === '00'}>{resultCells['00'] ?? '?'}</Cell>
                <Cell resultHighlight={resultHighlight === '01'}>{resultCells['01'] ?? '?'}</Cell>
              </MatrixRowCells>
              <MatrixRowCells>
                <Cell resultHighlight={resultHighlight === '10'}>{resultCells['10'] ?? '?'}</Cell>
                <Cell resultHighlight={resultHighlight === '11'}>{resultCells['11'] ?? '?'}</Cell>
              </MatrixRowCells>
            </Matrix>
          </div>
        </div>
        <div className="font-['DM_Mono',monospace] text-[0.8rem] text-[#6a6a8a] dark:text-[#9090b0] text-center min-h-[2rem]">{explain}</div>
      </div>
    </div>
  );
};

// ─── Interactive: Attention Heatmap ───

const ATTN_TOKENS = ['The', 'cat', 'sat', 'on', 'the', 'mat'];
const ATTN_WEIGHTS = [
  [0.9, 0.3, 0.1, 0.05, 0.7, 0.1],
  [0.4, 0.8, 0.5, 0.1, 0.2, 0.3],
  [0.1, 0.6, 0.9, 0.4, 0.1, 0.2],
  [0.05, 0.1, 0.3, 0.9, 0.2, 0.6],
  [0.7, 0.2, 0.1, 0.15, 0.9, 0.3],
  [0.1, 0.3, 0.2, 0.5, 0.3, 0.8],
];

const AttentionHeatmap = () => {
  const n = ATTN_TOKENS.length;
  return (
    <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl overflow-hidden my-8">
      <div className="bg-[#e8e8f0] dark:bg-[#16162a] px-6 py-4 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
        <span className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.15em] uppercase text-[#7c6aff]">Attention Heatmap — "The cat sat on the mat"</span>
      </div>
      <div className="p-6">
        <div className="mx-auto" style={{ display: 'grid', gridTemplateColumns: `36px repeat(${n}, 40px)`, gap: '2px', maxWidth: 36 + n * 42 + 'px' }}>
          {/* header row */}
          <div className="h-9" />
          {ATTN_TOKENS.map(t => (
            <div key={t + '-h'} className="h-9 flex items-center justify-center font-['DM_Mono',monospace] text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{t}</div>
          ))}
          {/* data rows */}
          {ATTN_TOKENS.map((rowTok, i) => (
            <>
              <div key={rowTok + '-l'} className="h-10 flex items-center font-['DM_Mono',monospace] text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0] pr-1">{rowTok}</div>
              {ATTN_WEIGHTS[i].map((w, j) => (
                <div
                  key={`${i}-${j}`}
                  className="w-10 h-10 rounded-[3px] flex items-center justify-center font-['DM_Mono',monospace] text-[0.55rem] border border-[#7c6aff]/20 cursor-default transition-transform hover:scale-110"
                  style={{ background: `rgba(124,106,255,${w * 0.8})`, color: `rgba(${w > 0.5 ? '255,255,255' : '0,0,0'},${w > 0.5 ? 0.8 : 0.3})` }}
                  title={`${ATTN_TOKENS[i]} → ${ATTN_TOKENS[j]}: ${w.toFixed(2)}`}
                >
                  {w.toFixed(1)}
                </div>
              ))}
            </>
          ))}
        </div>
        <div className="mt-4 font-['DM_Mono',monospace] text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0] text-center">
          Each cell = attention weight from row-token → col-token. Darker = stronger attention.
        </div>
      </div>
    </div>
  );
};

// ─── Interactive: GPU Visualization (OLD — commented out) ───
/*
const GPUVisualization_OLD = () => {
  const [cores, setCores] = useState<Record<number, 'active' | 'done'>>({});
  const [status, setStatus] = useState('Ready');
  const [btnText, setBtnText] = useState('▶ Run');
  const running = useRef(false);

  const runAnim = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBtnText('⏸');
    setCores({});
    setStatus('Loading matrix tiles into shared memory...');
    await sleep(600);
    setStatus('Executing matrix multiply — all cores firing in parallel!');
    const waves = 8;
    const perWave = 32;
    for (let w = 0; w < waves; w++) {
      const start = w * perWave;
      setCores(prev => {
        const next = { ...prev };
        for (let i = start; i < start + perWave; i++) next[i] = 'active';
        return next;
      });
      await sleep(80);
    }
    setStatus('Accumulating results → writing output tile to HBM...');
    await sleep(300);
    const allDone: Record<number, 'done'> = {};
    for (let i = 0; i < 256; i++) allDone[i] = 'done';
    setCores(allDone);
    setStatus('✓ Matrix multiply complete — 256 outputs computed in parallel!');
    setBtnText('↺ Replay');
    running.current = false;
  }, []);

  return (
    <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl overflow-hidden my-8">
      <div className="bg-[#e8e8f0] dark:bg-[#16162a] px-6 py-4 border-b border-[#d0d0e0] dark:border-[#2a2a45] flex items-center justify-between">
        <span className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.15em] uppercase text-[#7c6aff]">GPU Core Visualization — Parallel MatMul</span>
        <button onClick={runAnim} className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.1em] uppercase px-5 py-2 border border-[#7c6aff] rounded-md bg-transparent text-[#7c6aff] cursor-pointer hover:bg-[#7c6aff]/[0.15] transition-all">{btnText}</button>
      </div>
      <div className="p-6">
        <p className="font-['DM_Mono',monospace] text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0] mb-4">256 GPU cores computing a matrix multiply in parallel. Each core = one output cell.</p>
        <div className="grid gap-[3px] p-4 bg-[#e8e8f0] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-lg" style={{ gridTemplateColumns: 'repeat(16, 1fr)' }}>
          {Array.from({ length: 256 }, (_, i) => {
            const state = cores[i];
            let cls = 'aspect-square rounded-[2px] border transition-colors duration-300 ';
            if (state === 'active') cls += 'bg-[#7c6aff] border-[#7c6aff]';
            else if (state === 'done') cls += 'bg-[#6affe0] border-[#6affe0]';
            else cls += 'bg-[#eeeef4] dark:bg-[#16162a] border-[#d0d0e0] dark:border-[#2a2a45]';
            return <div key={i} className={cls} />;
          })}
        </div>
        <div className="font-['DM_Mono',monospace] text-[0.75rem] text-[#6a6a8a] dark:text-[#9090b0] mt-4 text-center">{status}</div>
      </div>
    </div>
  );
};
*/

// ─── Interactive: GPU Visualization (NEW — with memory hierarchy) ───

const GPU_GRID = 8; // 8x8 = 64 cores per thread block
const GPU_BLOCKS = 4; // 4 thread blocks shown

const GPUFullViz = () => {
  // Phase: 'idle' | 'loading' | 'computing' | 'writeback' | 'done'
  const [phase, setPhase] = useState<string>('idle');
  const [hbmActive, setHbmActive] = useState(false);
  const [sramBlocks, setSramBlocks] = useState<Set<number>>(new Set());
  const [activeCores, setActiveCores] = useState<Record<string, 'active' | 'done'>>({});
  const [status, setStatus] = useState('GPU idle — data sits in HBM (off-chip memory)');
  const [btnText, setBtnText] = useState('▶ Run');
  const running = useRef(false);

  const runAnim = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBtnText('⏸');
    setActiveCores({});
    setSramBlocks(new Set());
    setHbmActive(false);

    // Phase 1: HBM read
    setPhase('loading');
    setHbmActive(true);
    setStatus('Step 1 · Reading matrix tiles from HBM (global memory) → SRAM (shared memory)');
    await sleep(800);

    // Phase 2: Load into SRAM blocks one by one
    for (let b = 0; b < GPU_BLOCKS; b++) {
      setSramBlocks(prev => new Set([...prev, b]));
      await sleep(300);
    }
    setHbmActive(false);
    setStatus('Step 2 · Tiles loaded into shared memory — each thread block has its tile');
    await sleep(600);

    // Phase 3: All cores fire in parallel within each block
    setPhase('computing');
    setStatus('Step 3 · All cores compute in parallel — each core = one output element');
    for (let b = 0; b < GPU_BLOCKS; b++) {
      const updates: Record<string, 'active'> = {};
      for (let c = 0; c < GPU_GRID * GPU_GRID; c++) {
        updates[`${b}-${c}`] = 'active';
      }
      setActiveCores(prev => ({ ...prev, ...updates }));
      await sleep(100);
    }
    await sleep(500);

    // Phase 4: Write back
    setPhase('writeback');
    setStatus('Step 4 · Writing results back to HBM');
    setHbmActive(true);
    const allDone: Record<string, 'done'> = {};
    for (let b = 0; b < GPU_BLOCKS; b++) {
      for (let c = 0; c < GPU_GRID * GPU_GRID; c++) {
        allDone[`${b}-${c}`] = 'done';
      }
    }
    setActiveCores(allDone);
    await sleep(600);

    setPhase('done');
    setHbmActive(false);
    setStatus('Done — GPU pull model: data pulled from HBM → SRAM → cores → results written back');
    setBtnText('↺ Replay');
    running.current = false;
  }, []);

  const coreCell = (blockIdx: number, coreIdx: number) => {
    const state = activeCores[`${blockIdx}-${coreIdx}`];
    let cls = 'aspect-square rounded-[2px] border transition-all duration-300 ';
    if (state === 'active') cls += 'bg-[#7c6aff] border-[#7c6aff] shadow-[0_0_4px_rgba(124,106,255,0.5)]';
    else if (state === 'done') cls += 'bg-[#6affe0] border-[#6affe0]';
    else cls += 'bg-[#eeeef4] dark:bg-[#16162a] border-[#d0d0e0] dark:border-[#2a2a45]';
    return <div key={coreIdx} className={cls} />;
  };

  return (
    <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl overflow-hidden my-8">
      <div className="bg-[#e8e8f0] dark:bg-[#16162a] px-6 py-4 border-b border-[#d0d0e0] dark:border-[#2a2a45] flex items-center justify-between">
        <span className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.15em] uppercase text-[#7c6aff]">GPU — Pull Model (HBM → SRAM → Cores)</span>
        <button onClick={runAnim} className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.1em] uppercase px-5 py-2 border border-[#7c6aff] rounded-md bg-transparent text-[#7c6aff] cursor-pointer hover:bg-[#7c6aff]/[0.15] transition-all">{btnText}</button>
      </div>
      <div className="p-6">
        {/* HBM bar */}
        <div className={`rounded-lg border-2 p-3 mb-3 text-center font-['DM_Mono',monospace] text-[0.7rem] transition-all duration-500 ${
          hbmActive
            ? 'border-[#ffc96a] bg-[#ffc96a]/10 text-[#b8860b] dark:text-[#ffc96a]'
            : 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#0d0d18] text-[#6a6a8a] dark:text-[#9090b0]'
        }`}>
          HBM (High Bandwidth Memory) — 80 GB, 3.35 TB/s
          {hbmActive && <span className="ml-2 animate-pulse">●</span>}
        </div>

        {/* Arrow */}
        <div className="flex justify-center my-1">
          <div className={`text-sm transition-colors ${hbmActive ? 'text-[#ffc96a]' : 'text-[#6a6a8a] dark:text-[#9090b0]'}`}>
            {phase === 'loading' ? '↓ reading tiles' : phase === 'writeback' ? '↑ writing results' : '↕'}
          </div>
        </div>

        {/* Thread blocks with SRAM */}
        <div className="grid grid-cols-2 gap-3 mt-2">
          {Array.from({ length: GPU_BLOCKS }, (_, b) => (
            <div key={b} className={`rounded-lg border p-3 transition-all duration-500 ${
              sramBlocks.has(b)
                ? 'border-[#7c6aff]/50 bg-[#7c6aff]/[0.05]'
                : 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#0d0d18]'
            }`}>
              {/* SRAM label */}
              <div className={`text-center font-['DM_Mono',monospace] text-[0.6rem] mb-2 transition-colors ${
                sramBlocks.has(b) ? 'text-[#7c6aff]' : 'text-[#9a9ab0] dark:text-[#505070]'
              }`}>
                Block {b} · SRAM {sramBlocks.has(b) ? '(tile loaded)' : '(empty)'}
              </div>
              {/* Cores grid */}
              <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${GPU_GRID}, 1fr)` }}>
                {Array.from({ length: GPU_GRID * GPU_GRID }, (_, c) => coreCell(b, c))}
              </div>
            </div>
          ))}
        </div>

        <div className="font-['DM_Mono',monospace] text-[0.75rem] text-[#6a6a8a] dark:text-[#9090b0] mt-4 text-center">{status}</div>
      </div>
    </div>
  );
};

// ─── Interactive: TPU Systolic Array Visualization ───

const SYSTOLIC_SIZE = 8; // 8x8 systolic array

const TPUFullViz = () => {
  const [cells, setCells] = useState<Record<string, string>>({});
  const [rowInputs, setRowInputs] = useState<Set<number>>(new Set());
  const [colInputs, setColInputs] = useState<Set<number>>(new Set());
  const [accumulators, setAccumulators] = useState<Record<number, 'idle' | 'filling' | 'full'>>({});
  const [unifiedBufferActive, setUnifiedBufferActive] = useState(false);
  const [status, setStatus] = useState('Systolic array idle — weights pre-loaded into MAC units');
  const [btnText, setBtnText] = useState('▶ Run');
  const running = useRef(false);

  const runAnim = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBtnText('⏸');
    setCells({});
    setRowInputs(new Set());
    setColInputs(new Set());
    setAccumulators({});
    setUnifiedBufferActive(false);

    // Step 1: Weights pre-loaded
    setStatus('Step 1 · Weights pre-loaded into each MAC unit (stationary)');
    const preloaded: Record<string, string> = {};
    for (let r = 0; r < SYSTOLIC_SIZE; r++) {
      for (let c = 0; c < SYSTOLIC_SIZE; c++) {
        preloaded[`${r}-${c}`] = 'weighted';
      }
    }
    setCells(preloaded);
    await sleep(1000);

    // Step 2: Diagonal wave compute
    setStatus('Step 2 · Matrix A rows enter from left, Matrix B cols from top — data flows as a wave');
    const totalDiags = 2 * SYSTOLIC_SIZE - 1;
    for (let d = 0; d < totalDiags; d++) {
      if (d < SYSTOLIC_SIZE) {
        setRowInputs(prev => new Set([...prev, d]));
        setColInputs(prev => new Set([...prev, d]));
      }

      setCells(prev => {
        const next = { ...prev };
        for (let r = 0; r < SYSTOLIC_SIZE; r++) {
          const c = d - r;
          if (c >= 0 && c < SYSTOLIC_SIZE) {
            next[`${r}-${c}`] = 'computing';
          }
        }
        if (d > 0) {
          for (let r = 0; r < SYSTOLIC_SIZE; r++) {
            const c = (d - 1) - r;
            if (c >= 0 && c < SYSTOLIC_SIZE) {
              next[`${r}-${c}`] = 'done';
            }
          }
        }
        return next;
      });

      // Accumulators fill as bottom-row cells complete (when last row cell on diagonal finishes)
      // A cell at (SYSTOLIC_SIZE-1, c) finishes when d-1 = (SYSTOLIC_SIZE-1) + c → c = d - SYSTOLIC_SIZE
      if (d > 0) {
        const finishedCol = (d - 1) - (SYSTOLIC_SIZE - 1);
        if (finishedCol >= 0 && finishedCol < SYSTOLIC_SIZE) {
          setAccumulators(prev => ({ ...prev, [finishedCol]: 'filling' }));
        }
      }

      await sleep(180);
    }

    // Final diagonal done
    setCells(prev => {
      const next = { ...prev };
      for (let r = 0; r < SYSTOLIC_SIZE; r++) {
        const c = (totalDiags - 1) - r;
        if (c >= 0 && c < SYSTOLIC_SIZE) {
          next[`${r}-${c}`] = 'done';
        }
      }
      return next;
    });
    // Last accumulator column
    setAccumulators(prev => ({ ...prev, [SYSTOLIC_SIZE - 1]: 'filling' }));
    await sleep(300);

    // Step 3: All accumulators full
    setStatus('Step 3 · Results collected in accumulators → draining to Unified Buffer');
    const allFull: Record<number, 'full'> = {};
    for (let c = 0; c < SYSTOLIC_SIZE; c++) allFull[c] = 'full';
    setAccumulators(allFull);
    await sleep(500);

    // Step 4: Unified Buffer receives
    setUnifiedBufferActive(true);
    setStatus('Step 4 · Results stored in Unified Buffer (on-chip SRAM) — ready for next layer');
    await sleep(800);

    setStatus('Done — TPU push model: data flows through array → accumulators → Unified Buffer. No HBM round-trip between layers.');
    setBtnText('↺ Replay');
    running.current = false;
  }, []);

  return (
    <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl overflow-hidden my-8">
      <div className="bg-[#e8e8f0] dark:bg-[#16162a] px-6 py-4 border-b border-[#d0d0e0] dark:border-[#2a2a45] flex items-center justify-between">
        <span className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.15em] uppercase text-[#ff6a9a]">TPU — Push Model (Systolic Array)</span>
        <button onClick={runAnim} className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.1em] uppercase px-5 py-2 border border-[#ff6a9a] rounded-md bg-transparent text-[#ff6a9a] cursor-pointer hover:bg-[#ff6a9a]/[0.15] transition-all">{btnText}</button>
      </div>
      <div className="p-6">
        <div className="flex justify-center">
          <div>
            {/* Column input labels (Matrix B) */}
            <div className="flex ml-10 mb-1">
              {Array.from({ length: SYSTOLIC_SIZE }, (_, c) => (
                <div key={c} className={`w-8 h-5 flex items-center justify-center font-['DM_Mono',monospace] text-[0.55rem] transition-colors duration-300 ${
                  colInputs.has(c) ? 'text-[#ffc96a]' : 'text-[#9a9ab0] dark:text-[#505070]'
                }`}>
                  {colInputs.has(c) ? '↓B' + c : 'B' + c}
                </div>
              ))}
            </div>

            {/* Rows with row input labels (Matrix A) */}
            {Array.from({ length: SYSTOLIC_SIZE }, (_, r) => (
              <div key={r} className="flex items-center">
                <div className={`w-10 text-right pr-2 font-['DM_Mono',monospace] text-[0.55rem] transition-colors duration-300 ${
                  rowInputs.has(r) ? 'text-[#ffc96a]' : 'text-[#9a9ab0] dark:text-[#505070]'
                }`}>
                  {rowInputs.has(r) ? 'A' + r + '→' : 'A' + r}
                </div>
                <div className="flex gap-[2px]">
                  {Array.from({ length: SYSTOLIC_SIZE }, (_, c) => {
                    const state = cells[`${r}-${c}`] || 'idle';
                    let cls = 'w-8 h-8 rounded-[2px] border transition-all duration-200 flex items-center justify-center text-[0.5rem] font-["DM_Mono",monospace] ';
                    if (state === 'computing') cls += 'bg-[#ff6a9a] border-[#ff6a9a] shadow-[0_0_6px_rgba(255,106,154,0.6)] text-white';
                    else if (state === 'done') cls += 'bg-[#6affe0] border-[#6affe0] text-[#0a0a0f]';
                    else if (state === 'weighted') cls += 'bg-[#ff6a9a]/10 border-[#ff6a9a]/30 text-[#ff6a9a]/50';
                    else cls += 'bg-[#eeeef4] dark:bg-[#16162a] border-[#d0d0e0] dark:border-[#2a2a45] text-transparent';
                    return <div key={c} className={cls}>{state === 'weighted' ? 'W' : state === 'computing' ? '×+' : state === 'done' ? '✓' : ''}</div>;
                  })}
                </div>
              </div>
            ))}

            {/* Arrow from array to accumulators */}
            <div className="flex ml-10 my-1">
              <div className="font-['DM_Mono',monospace] text-[0.55rem] text-[#6a6a8a] dark:text-[#9090b0]">
                ↓ partial sums exit bottom edge
              </div>
            </div>

            {/* Accumulator row */}
            <div className="flex items-center">
              <div className="w-10 text-right pr-2 font-['DM_Mono',monospace] text-[0.5rem] text-[#6a6a8a] dark:text-[#9090b0]">ACC</div>
              <div className="flex gap-[2px]">
                {Array.from({ length: SYSTOLIC_SIZE }, (_, c) => {
                  const state = accumulators[c] || 'idle';
                  let cls = 'w-8 h-8 rounded-[2px] border transition-all duration-300 flex items-center justify-center text-[0.5rem] font-["DM_Mono",monospace] ';
                  if (state === 'full') cls += 'bg-[#6affe0] border-[#6affe0] text-[#0a0a0f]';
                  else if (state === 'filling') cls += 'bg-[#ffc96a]/40 border-[#ffc96a] text-[#b8860b] dark:text-[#ffc96a] animate-pulse';
                  else cls += 'bg-[#eeeef4] dark:bg-[#16162a] border-[#d0d0e0] dark:border-[#2a2a45] text-[#9a9ab0] dark:text-[#505070]';
                  return <div key={c} className={cls}>{state === 'full' ? '✓' : state === 'filling' ? 'Σ' : '·'}</div>;
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Arrow to Unified Buffer */}
        <div className="flex justify-center my-2">
          <div className={`text-sm transition-colors ${unifiedBufferActive ? 'text-[#6affe0]' : 'text-[#6a6a8a] dark:text-[#9090b0]'}`}>
            ↓
          </div>
        </div>

        {/* Unified Buffer bar */}
        <div className={`rounded-lg border-2 p-3 text-center font-['DM_Mono',monospace] text-[0.7rem] transition-all duration-500 ${
          unifiedBufferActive
            ? 'border-[#6affe0] bg-[#6affe0]/10 text-[#5a9a8a] dark:text-[#6affe0]'
            : 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#0d0d18] text-[#6a6a8a] dark:text-[#9090b0]'
        }`}>
          Unified Buffer (On-Chip SRAM) — 24 MB
          {unifiedBufferActive && <span className="ml-2 animate-pulse">●</span>}
        </div>

        <div className="font-['DM_Mono',monospace] text-[0.75rem] text-[#6a6a8a] dark:text-[#9090b0] mt-4 text-center">{status}</div>
      </div>
    </div>
  );
};

// ─── Side-by-side version (for comparison) ───

const GPUvsTPUSideBySide = () => {
  return (
    <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl overflow-hidden my-8">
      <div className="bg-[#e8e8f0] dark:bg-[#16162a] px-6 py-4 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
        <span className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.15em] uppercase text-[#7c6aff]">GPU vs TPU — Side by Side</span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><GPUFullViz /></div>
          <div><TPUFullViz /></div>
        </div>
      </div>
    </div>
  );
};

// ─── Table of Contents ───

const TOC_ITEMS = [
  { id: 's1', label: '01 · Matrix Basics' },
  { id: 's2', label: '02 · Matrix Multiplication' },
  { id: 's3', label: '03 · Neurons & Layers' },
  { id: 's4', label: '04 · CNNs' },
  { id: 's5', label: '05 · RNNs & LSTMs' },
  { id: 's6', label: '06 · Transformers' },
  { id: 's7', label: '07 · Tokens & Embeddings' },
  { id: 's8', label: '08 · GPUs & TPUs' },
  { id: 's9', label: '09 · The Full Stack' },
];

// ─── Main Page Component ───

const MatmulTutorial = () => {
  const { pageId, activeUsers, analytics } = usePageAnalytics('From Matrices to Minds');

  return (
    <div className="min-h-screen">
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Back Button */}
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }}>
          <Link to="/blog" className="inline-flex items-center space-x-2 text-[#001F3F] dark:text-white hover:opacity-70 transition-opacity mb-8">
            <ArrowLeft className="w-5 h-5" /><span>Back to Blog</span>
          </Link>
        </motion.div>

        {/* Header */}
        <motion.header initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="mb-12 space-y-6">
          <div className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.25em] uppercase text-[#7c6aff] px-4 py-1.5 border border-[#7c6aff]/30 rounded-full bg-[#7c6aff]/[0.08] inline-block">
            Complete Technical Deep-Dive
          </div>
          <h1 className="font-['Playfair_Display',serif] text-[clamp(3rem,8vw,5rem)] font-black leading-none tracking-tight text-[#001F3F] dark:text-white">
            From <em className="italic text-[#7c6aff]">Matrices</em><br />to Minds
          </h1>
          <p className="text-lg text-[#001F3F]/70 dark:text-white/70 max-w-xl leading-relaxed">
            How a grid of numbers — multiplied together billions of times — became the engine of modern intelligence.
          </p>
          <p className="text-sm text-[#001F3F]/60 dark:text-white/60">Author: Nikhil Kulkarni, Claude Code</p>
          <div className="flex flex-wrap items-center gap-4 text-[#001F3F]/60 dark:text-white/60">
            <div className="flex items-center space-x-2"><Calendar className="w-4 h-4" /><span>March 5, 2026</span></div>
            <div className="flex items-center space-x-2"><Clock className="w-4 h-4" /><span>25 min read</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Linear Algebra', 'Neural Networks', 'Transformers', 'GPUs'].map(tag => (
              <span key={tag} className="px-3 py-1 text-sm rounded-full bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white">{tag}</span>
            ))}
          </div>
          {/* TOC */}
          <div className="flex flex-wrap gap-2 pt-4">
            {TOC_ITEMS.map(item => (
              <a key={item.id} href={`#${item.id}`} className="font-['DM_Mono',monospace] text-[0.7rem] tracking-wide px-3 py-1.5 border border-[#d0d0e0] dark:border-[#2a2a45] rounded bg-[#f0f0f8] dark:bg-[#10101a] text-[#6a6a8a] dark:text-[#9090b0] no-underline hover:border-[#7c6aff] hover:text-[#7c6aff] hover:bg-[#7c6aff]/[0.15] transition-all">
                {item.label}
              </a>
            ))}
          </div>
        </motion.header>

        {/* Content */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}>

          {/* ─── Chapter 1: Matrix Basics ─── */}
          <section id="s1" className="py-16">
            <SectionTag>Chapter 01</SectionTag>
            <SectionTitle>What is a Matrix?</SectionTitle>
            <Lead>A matrix is just a rectangular grid of numbers — nothing more. But when you learn to multiply them, you unlock the fundamental operation behind every neural network ever built.</Lead>

            <P>Imagine you have a 3×3 grid of numbers. Each position is called an <Strong>element</Strong>. The grid has <Strong>rows</Strong> (horizontal) and <Strong>columns</Strong> (vertical). We describe a matrix by its shape: rows × columns.</P>

            <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl p-8 my-8">
              <h4 className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.2em] uppercase text-[#7c6aff] mb-6">A 3×2 Matrix · "Shape is (3, 2)"</h4>
              <div className="flex items-center gap-6 flex-wrap justify-center">
                <div className="text-center">
                  <Matrix>
                    <MatrixRowCells><Cell>2</Cell><Cell>5</Cell></MatrixRowCells>
                    <MatrixRowCells><Cell>−1</Cell><Cell>3</Cell></MatrixRowCells>
                    <MatrixRowCells><Cell>4</Cell><Cell>0</Cell></MatrixRowCells>
                  </Matrix>
                  <div className="font-['DM_Mono',monospace] text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0] mt-4">3 rows · 2 columns</div>
                </div>
                <div className="text-left max-w-[350px] text-[#6a6a8a] dark:text-[#9090b0] text-[0.9rem] leading-relaxed">
                  <p className="text-[#001F3F] dark:text-[#e8e8f0] font-medium mb-2">Notation: A[i][j]</p>
                  <p>Row index <strong className="text-[#7c6aff]">i</strong> goes top→bottom<br />
                  Column index <strong className="text-[#6affe0]">j</strong> goes left→right<br />
                  So A[0][1] = <strong className="text-[#ff6a9a]">5</strong><br />
                  And A[2][0] = <strong className="text-[#ff6a9a]">4</strong></p>
                </div>
              </div>
            </div>

            <SectionSubtitle>Why do we need matrices?</SectionSubtitle>
            <P>Matrices are a compact way to represent <Strong>linear transformations</Strong> — functions that rotate, scale, stretch, or project data. Instead of writing 100 separate equations, you write one matrix operation.</P>

            <Callout type="insight">In deep learning, a matrix row is often a <Strong>data sample</Strong> and columns are <Strong>features</Strong>. A dataset of 1000 images at 28×28 pixels becomes a matrix of shape (1000, 784). Everything flows from there.</Callout>
          </section>

          {/* ─── Chapter 2: Matrix Multiplication ─── */}
          <section id="s2" className="py-16">
            <SectionTag>Chapter 02</SectionTag>
            <SectionTitle>Matrix Multiplication</SectionTitle>
            <Lead>This is <em>the</em> operation. Every layer in every neural network is fundamentally doing this one thing.</Lead>

            <SectionSubtitle>The Rule</SectionSubtitle>
            <P>To multiply matrix <Strong>A</Strong> (shape m×k) by matrix <Strong>B</Strong> (shape k×n), the <Strong>inner dimensions must match</Strong>. The result is shape m×n.</P>

            <MathBlock label="shape rule" variant="purple">{`  A      ×      B      =      C
(m × k)    (k × n)       (m × n)

  ↑               ↑
  These must match!`}</MathBlock>

            <P>Each element C[i][j] is computed as the <Strong>dot product</Strong> of row i of A with column j of B:</P>

            <MathBlock label="dot product" variant="green">{`  C[i][j] = Σ  A[i][k] × B[k][j]
             k

  = A[i][0]·B[0][j] + A[i][1]·B[1][j] + A[i][2]·B[2][j] + ...`}</MathBlock>

            <SectionSubtitle>Step-by-step Example</SectionSubtitle>
            <MatMulAnimation />

            <SectionSubtitle>FLOP Count — Why this matters for AI</SectionSubtitle>
            <P>Multiplying an (m×k) matrix by a (k×n) matrix requires <Strong>m × k × n multiplications and additions</Strong> — called FLOPs (Floating Point Operations). For a single transformer layer with hidden size 4096:</P>

            <MathBlock label="example" variant="yellow">{`  Weight matrix shape:     (4096 × 4096)
  Batch of 512 tokens:     (512 × 4096)

  FLOPs per layer:         512 × 4096 × 4096 ≈ 8.6 Billion
  Layers in GPT-3:         96

  Total FLOPs per forward pass: ~830 Billion`}</MathBlock>

            <Callout type="insight">Training GPT-3 required ~3.14 × 10²³ FLOPs. At peak A100 GPU throughput (312 TFLOPS), that would take ~32 years on a single GPU. Meta trained LLaMA-3 on ~16,000 GPUs in parallel.</Callout>
          </section>

          {/* ─── Chapter 3: Neurons & Layers ─── */}
          <section id="s3" className="py-16">
            <SectionTag>Chapter 03</SectionTag>
            <SectionTitle>From Matrix Multiplication to Neural Networks</SectionTitle>
            <Lead>A neural network is, at its core, a sequence of matrix multiplications separated by non-linear functions.</Lead>

            <SectionSubtitle>The Single Neuron</SectionSubtitle>
            <P>One neuron takes a vector of inputs <Strong>x</Strong>, multiplies by a weight vector <Strong>w</Strong>, adds a bias <Strong>b</Strong>, then applies an activation function <Strong>f</Strong>:</P>

            <MathBlock label="neuron" variant="purple">{`  output = f( w₁x₁ + w₂x₂ + w₃x₃ + b )
         = f( w·x + b )
         = f( dot_product(w, x) + b )`}</MathBlock>

            <SectionSubtitle>A Full Layer = One Matrix Multiply</SectionSubtitle>
            <P>A layer with <Strong>n</Strong> neurons, each looking at <Strong>m</Strong> inputs, is just one matrix multiply:</P>

            <MathBlock label="linear layer" variant="green">{`  Inputs:   x  shape (batch_size, m)    — B samples, m features each
  Weights:  W  shape (m, n)             — m inputs → n outputs
  Bias:     b  shape (n,)

  Output = f( x @ W + b )              — shape (batch_size, n)

  "@" = matrix multiply
  f   = activation (ReLU, sigmoid, etc.)`}</MathBlock>

            <ArchDiagram>
              <ArchBlock variant="accent" label="Input Layer" desc="x — raw features" />
              <ArchArrow />
              <ArchBlock label="Linear: y = xW + b" desc="one matrix multiply" />
              <ArchArrow />
              <ArchBlock variant="green" label="Activation: f(y)" desc="ReLU, GELU, sigmoid..." />
              <ArchArrow />
              <ArchBlock label="Linear: z = yW₂ + b₂" desc="another matrix multiply" />
              <ArchArrow />
              <ArchBlock variant="pink" label="Output Layer" desc="predictions / logits" />
            </ArchDiagram>

            <SectionSubtitle>Activation Functions — The Non-Linearity</SectionSubtitle>
            <P>Without activation functions, stacking linear layers would still be linear (you can always combine two matrix multiplies into one). Activations are what let networks learn <Strong>curved decision boundaries</Strong>.</P>

            <MathBlock label="activations" variant="purple">{`  ReLU(x)    = max(0, x)           ← most common in CNNs/MLPs
  GELU(x)    ≈ x·Φ(x)             ← used in GPT, BERT
  Sigmoid(x) = 1 / (1 + e⁻ˣ)     ← outputs 0→1, for gates
  Tanh(x)    = (eˣ - e⁻ˣ)/(eˣ+e⁻ˣ)  ← outputs -1→1, for RNNs
  Softmax(x) = eˣⁱ / Σeˣʲ         ← for probability distributions`}</MathBlock>

            <SectionSubtitle>Backpropagation — Learning via Chain Rule</SectionSubtitle>
            <P>Networks learn by computing the gradient of the loss with respect to every weight, then nudging weights in the direction that reduces loss. This uses the <Strong>chain rule of calculus</Strong> applied backward through the network — hence "backprop".</P>

            <MathBlock label="gradient descent" variant="pink">{`  Forward:  x → [W₁] → [ReLU] → [W₂] → [softmax] → loss L

  Backward: ∂L/∂W₁ = ∂L/∂y₂ · ∂y₂/∂y₁ · ∂y₁/∂W₁   (chain rule)

  Update:   W₁ ← W₁ - α·∂L/∂W₁     (α = learning rate)

  This backward pass is ALSO mostly matrix multiplications!`}</MathBlock>

            <Callout type="warning">Both the <Strong>forward pass</Strong> (inference) and the <Strong>backward pass</Strong> (training) are dominated by matrix multiplications. This is why GPU/TPU hardware is designed around one thing: performing massive matrix multiplies as fast as possible.</Callout>
          </section>

          {/* ─── Chapter 4: CNNs ─── */}
          <section id="s4" className="py-16">
            <SectionTag>Chapter 04</SectionTag>
            <SectionTitle>Convolutional Neural Networks (CNNs)</SectionTitle>
            <Lead>CNNs handle spatial data like images. They replace big matrix multiplies with sliding <em>filters</em> — but it's still matrix multiplication under the hood.</Lead>

            <SectionSubtitle>The Convolution Operation</SectionSubtitle>
            <P>Instead of connecting every input pixel to every neuron (which would be enormous), a CNN uses a small <Strong>kernel/filter</Strong> (e.g., 3×3) that slides across the image, computing a dot product at each position:</P>

            <MathBlock label="convolution" variant="purple">{`  Input image:     H × W × C    (height × width × channels)
  Filter/Kernel:   K × K × C    (usually 3×3 or 5×5)

  For each position (i,j) in the output:
    output[i][j] = sum( input[i:i+K, j:j+K] ⊙ kernel )
                                ↑
                        element-wise multiply, then sum
                        = dot product of two vectors!`}</MathBlock>

            <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl p-8 my-8">
              <h4 className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.2em] uppercase text-[#7c6aff] mb-6">3×3 Convolution — Edge Detection</h4>
              <div className="flex items-start gap-6 flex-wrap justify-center">
                <div className="text-center">
                  <div className="font-['DM_Mono',monospace] text-[0.65rem] text-[#6a6a8a] dark:text-[#9090b0] mb-2">Input Patch</div>
                  <Matrix>
                    <MatrixRowCells><Cell>0</Cell><Cell highlight>255</Cell><Cell highlight>255</Cell></MatrixRowCells>
                    <MatrixRowCells><Cell>0</Cell><Cell highlight>255</Cell><Cell highlight>255</Cell></MatrixRowCells>
                    <MatrixRowCells><Cell>0</Cell><Cell>0</Cell><Cell>0</Cell></MatrixRowCells>
                  </Matrix>
                </div>
                <span className="font-['Playfair_Display',serif] text-3xl text-[#ff6a9a] self-center">⊙</span>
                <div className="text-center">
                  <div className="font-['DM_Mono',monospace] text-[0.65rem] text-[#6a6a8a] dark:text-[#9090b0] mb-2">Sobel Kernel</div>
                  <Matrix>
                    <MatrixRowCells><Cell style={{ color: '#ff6a9a' }}>-1</Cell><Cell style={{ color: '#ff6a9a' }}>0</Cell><Cell>+1</Cell></MatrixRowCells>
                    <MatrixRowCells><Cell style={{ color: '#ff6a9a' }}>-2</Cell><Cell>0</Cell><Cell>+2</Cell></MatrixRowCells>
                    <MatrixRowCells><Cell style={{ color: '#ff6a9a' }}>-1</Cell><Cell style={{ color: '#ff6a9a' }}>0</Cell><Cell>+1</Cell></MatrixRowCells>
                  </Matrix>
                </div>
                <span className="font-['Playfair_Display',serif] text-3xl text-[#ff6a9a] self-center">=</span>
                <div className="text-center">
                  <div className="font-['DM_Mono',monospace] text-[0.65rem] text-[#6a6a8a] dark:text-[#9090b0] mb-2">Output</div>
                  <Matrix>
                    <MatrixRowCells><Cell resultHighlight>1020</Cell></MatrixRowCells>
                  </Matrix>
                  <div className="text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0] mt-2">Strong edge detected!</div>
                </div>
              </div>
            </div>

            <SectionSubtitle>Convolution is Matrix Multiplication (im2col)</SectionSubtitle>
            <P>Modern frameworks convert convolution into a matrix multiply using <Strong>im2col</Strong>: each filter application becomes a column, and you batch all of them into one big matrix multiply that GPUs love.</P>

            <MathBlock label="im2col trick" variant="green">{`  1. Reshape input patches → matrix of shape (N·H'·W', K²·C)
  2. Reshape filters       → matrix of shape (K²·C, F)
  3. One matrix multiply   → output of shape (N·H'·W', F)
  4. Reshape back          → (N, H', W', F)

  This is why convolution training is fast: it's all GEMM!`}</MathBlock>

            <SectionSubtitle>Typical CNN Architecture</SectionSubtitle>
            <ArchDiagram>
              <ArchBlock variant="yellow" label="Input Image (224×224×3)" desc="3 channels: R, G, B" />
              <ArchArrow />
              <ArchBlock label="Conv Layer (64 filters, 3×3)" desc="extracts local features" />
              <ArchArrow />
              <ArchBlock variant="green" label="BatchNorm + ReLU" desc="normalize + non-linearity" />
              <ArchArrow />
              <ArchBlock label="MaxPool (2×2)" desc="downsample: 112×112" />
              <ArchArrow />
              <ArchBlock label="More Conv Blocks..." desc="deeper features emerge" />
              <ArchArrow />
              <ArchBlock variant="accent" label="Global Average Pool" desc="spatial → vector" />
              <ArchArrow />
              <ArchBlock variant="pink" label="Fully Connected + Softmax" desc="final matrix multiply → classes" />
            </ArchDiagram>
          </section>

          {/* ─── Chapter 5: RNNs & LSTMs ─── */}
          <section id="s5" className="py-16">
            <SectionTag>Chapter 05</SectionTag>
            <SectionTitle>Recurrent Neural Networks (RNNs & LSTMs)</SectionTitle>
            <Lead>CNNs handle space. RNNs handle <em>time</em> — sequences of data where the order matters, like text, audio, or sensor readings.</Lead>

            <SectionSubtitle>The Core Idea: Hidden State</SectionSubtitle>
            <P>An RNN processes one token at a time, maintaining a <Strong>hidden state</Strong> h that acts as "memory" of everything seen so far. At each step:</P>

            <MathBlock label="rnn step" variant="purple">{`  hₜ = tanh( Wₕₕ · hₜ₋₁  +  Wₓₕ · xₜ  +  b )
              ↑ previous     ↑ current
              hidden          input

  yₜ = Wₕ_out · hₜ                  ← output at step t

  Still just matrix multiplications!`}</MathBlock>

            <SectionSubtitle>The Vanishing Gradient Problem</SectionSubtitle>
            <P>RNNs struggle with <Strong>long-range dependencies</Strong>. Gradients flowing backward through many time steps get multiplied by the same weight matrix repeatedly — they either <Strong>vanish</Strong> (→ 0) or <Strong>explode</Strong> (→ ∞).</P>

            <SectionSubtitle>LSTM: Gated Memory</SectionSubtitle>
            <P>LSTMs (Long Short-Term Memory) add explicit <Strong>gates</Strong> to control what gets remembered, forgotten, or output. All gates are... matrix multiplications:</P>

            <MathBlock label="lstm gates" variant="pink">{`  fₜ = σ( Wf · [hₜ₋₁, xₜ] + bf )   ← Forget gate: what to erase
  iₜ = σ( Wi · [hₜ₋₁, xₜ] + bi )   ← Input gate:  what to write
  g̃ₜ = tanh(Wg · [hₜ₋₁, xₜ] + bg)  ← Candidate memory
  oₜ = σ( Wo · [hₜ₋₁, xₜ] + bo )   ← Output gate: what to read

  Cell:  cₜ = fₜ ⊙ cₜ₋₁ + iₜ ⊙ g̃ₜ  ← Update cell state
  Hidden: hₜ = oₜ ⊙ tanh(cₜ)        ← New hidden state

  ⊙ = element-wise multiply
  σ = sigmoid (outputs between 0 and 1 = "gate open/closed")`}</MathBlock>

            <Callout type="warning">The <Strong>fundamental problem</Strong> with RNNs and LSTMs: they must process tokens one-at-a-time, sequentially. You can't parallelize across the sequence length. This makes them slow to train and limits context length. This is what Transformers were designed to solve.</Callout>
          </section>

          {/* ─── Chapter 6: Transformers ─── */}
          <section id="s6" className="py-16">
            <SectionTag>Chapter 06</SectionTag>
            <SectionTitle>Transformers & Attention</SectionTitle>
            <Lead>The 2017 paper "Attention Is All You Need" discarded recurrence entirely. Instead, every position attends to every other position — simultaneously, in parallel — using one elegant matrix operation.</Lead>

            <SectionSubtitle>Self-Attention: The Core Mechanism</SectionSubtitle>
            <P>For each token, we compute three vectors by multiplying its embedding by three learned weight matrices:</P>

            <MathBlock label="qkv projections" variant="purple">{`  Q = X · Wq    (Queries — "what am I looking for?")
  K = X · Wk    (Keys    — "what do I contain?")
  V = X · Wv    (Values  — "what do I output if you look at me?")

  X shape:  (seq_len, d_model)       e.g., (512, 768)
  W shapes: (d_model, d_k)           e.g., (768, 64)`}</MathBlock>

            <P>Then attention scores are computed, scaled, softmaxed, and used to weight the values:</P>

            <MathBlock label="attention formula" variant="green">{`  Attention(Q, K, V) = softmax( Q·Kᵀ / √d_k ) · V
                                ↑         ↑      ↑
                          dot product  scale   weighted
                          of all pairs         sum of V

  Q·Kᵀ shape:  (seq_len, seq_len)    ← every token sees every token!
  After softmax: each row sums to 1 (probability distribution)
  Final output:  (seq_len, d_k)      ← rich, context-aware vectors`}</MathBlock>

            <AttentionHeatmap />

            <SectionSubtitle>Multi-Head Attention</SectionSubtitle>
            <P>Instead of one attention pass, Transformers run <Strong>h heads</Strong> in parallel — each learning a different type of relationship (e.g., one head learns syntax, another learns coreference):</P>

            <MathBlock label="multi-head" variant="yellow">{`  head_i = Attention(X·Wq_i, X·Wk_i, X·Wv_i)

  MultiHead(X) = Concat(head_1, ..., head_h) · Wo

  If d_model=768, h=12:  each head d_k = 768/12 = 64

  Total params per attention layer ≈ 4 × d_model²
  For d_model=768: ≈ 2.4 million params per layer`}</MathBlock>

            <SectionSubtitle>The Full Transformer Block</SectionSubtitle>
            <ArchDiagram>
              <ArchBlock variant="yellow" label="Input Embeddings" desc="token embeddings + positional encoding" />
              <ArchArrow />
              <ArchBlock variant="accent" label="Multi-Head Self-Attention" desc="Q·Kᵀ/√d · V — parallel matrix ops" />
              <ArchArrow />
              <ArchBlock label="Add & LayerNorm" desc="residual connection" />
              <ArchArrow />
              <ArchBlock variant="green" label="Feed-Forward Network" desc="2 linear layers: 4× expand then contract" />
              <ArchArrow />
              <ArchBlock label="Add & LayerNorm" desc="residual connection" />
              <ArchArrow />
              <ArchBlock variant="pink" label="→ Repeat N times (e.g., 96 layers in GPT-3)" desc="" />
            </ArchDiagram>

            <SectionSubtitle>Why Transformers Beat RNNs</SectionSubtitle>
            <CompareTable
              headers={['Property', 'RNN/LSTM', 'Transformer']}
              rows={[
                ['Parallelism', "Sequential — can't parallelize across tokens", 'Fully parallel — all tokens computed at once'],
                ['Long-range context', 'Degrades with distance (vanishing gradients)', 'O(1) path between any two positions'],
                ['Memory', 'Fixed-size hidden state bottleneck', 'Explicit attention over all positions'],
                ['Compute', 'O(n) time per layer', 'O(n²) attention but massively parallel'],
                ['Scaling', 'Stops improving past ~1B params', 'Power-law scaling — bigger = better'],
              ]}
            />
          </section>

          {/* ─── Chapter 7: Tokens & Embeddings ─── */}
          <section id="s7" className="py-16">
            <SectionTag>Chapter 07</SectionTag>
            <SectionTitle>Tokens & Embeddings</SectionTitle>
            <Lead>Before any matrix can multiply, raw text must become numbers. The tokenization pipeline is the bridge between human language and matrix operations.</Lead>

            <SectionSubtitle>What is a Token?</SectionSubtitle>
            <P>Tokens are the atomic units a model sees. They are <Strong>not</Strong> words — they are subword pieces chosen to minimize vocabulary size while handling any input. Using <Strong>Byte-Pair Encoding (BPE)</Strong>:</P>

            <MathBlock label="tokenization" variant="purple">{`  "ChatGPT is amazing!"
  → ["Chat", "G", "PT", " is", " amaz", "ing", "!"]
  → [  9890,  38,  2898,  374,  16682,   278,   0  ]
                          ↑
                    token IDs (integers)`}</MathBlock>

            <SectionSubtitle>Embeddings — From ID to Vector</SectionSubtitle>
            <P>Each token ID is looked up in an <Strong>embedding matrix</Strong> — a learned table mapping every token to a dense vector. This lookup is itself a matrix multiply (one-hot vector times embedding matrix):</P>

            <MathBlock label="embedding lookup" variant="green">{`  Vocabulary size:  50,257 tokens  (GPT-2)
  Embedding dim:    768            (GPT-2 small)

  Embedding matrix E:  shape (50257, 768)
  Token ID = 9890:     → E[9890]  = vector of 768 floats

  Full sequence of 512 tokens → matrix (512, 768)
  This is X — the input to the first Transformer block.`}</MathBlock>

            <SectionSubtitle>Positional Encoding</SectionSubtitle>
            <P>Attention is <Strong>permutation-invariant</Strong> — it doesn't know that token 0 comes before token 1. Positional encodings inject this order information:</P>

            <MathBlock label="sinusoidal (original)" variant="yellow">{`  PE[pos, 2i]   = sin( pos / 10000^(2i/d_model) )
  PE[pos, 2i+1] = cos( pos / 10000^(2i/d_model) )

  Input to transformer = token_embedding + positional_embedding

  Modern LLMs use RoPE (Rotary Position Embedding) instead —
  it applies rotation matrices directly inside attention,
  allowing better extrapolation to longer sequences.`}</MathBlock>

            <SectionSubtitle>From Token to Output Probability</SectionSubtitle>
            <FlowDiagram>
              <FlowBox variant="hi">token IDs<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">[9890, 38, ...]</div></FlowBox>
              <FlowArrow />
              <FlowBox>embedding lookup<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">(vocab, d_model)</div></FlowBox>
              <FlowArrow />
              <FlowBox>+ pos encoding</FlowBox>
              <FlowArrow />
              <FlowBox variant="hi2">N × Transformer blocks<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">attention + FFN</div></FlowBox>
              <FlowArrow />
              <FlowBox>final LayerNorm</FlowBox>
              <FlowArrow />
              <FlowBox variant="hi3">lm_head · Wᵀ<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">(d_model → vocab)</div></FlowBox>
              <FlowArrow />
              <FlowBox>softmax<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">→ probabilities</div></FlowBox>
              <FlowArrow />
              <FlowBox variant="hi">sample next token</FlowBox>
            </FlowDiagram>

            <Callout type="insight">The final projection (d_model → vocab_size) is the largest matrix multiply in the forward pass. For Llama-3 (d_model=8192, vocab=128K): that's a matrix of shape (8192, 131072) = over 1 billion parameters in a single layer.</Callout>
          </section>

          {/* ─── Chapter 8: GPUs & TPUs ─── */}
          <section id="s8" className="py-16">
            <SectionTag>Chapter 08</SectionTag>
            <SectionTitle>GPUs & TPUs: The Hardware Behind the Math</SectionTitle>
            <Lead>Matrix multiplication is embarrassingly parallel. GPUs and TPUs are purpose-built to exploit this — they're not fast computers, they're fast matrix multipliers.</Lead>

            <SectionSubtitle>CPU vs GPU Architecture</SectionSubtitle>
            <CompareTable
              headers={['Property', 'CPU (e.g. Intel Xeon)', 'GPU (e.g. NVIDIA H100)']}
              rows={[
                ['Core count', '8–128 complex cores', '14,592 CUDA cores'],
                ['Design goal', 'Low latency, serial tasks', 'High throughput, parallel tasks'],
                ['Cache', 'Large L1/L2/L3 cache hierarchy', 'Small cache, high bandwidth HBM memory'],
                ['Memory bandwidth', '~100 GB/s', '3.35 TB/s (H100 SXM)'],
                ['FP16 FLOPS', '~1–2 TFLOPS', '989 TFLOPS (tensor cores)'],
                ['Ideal workload', 'OS, databases, branchy code', 'Matrix multiplies, convolutions'],
              ]}
            />

            <SectionSubtitle>Tensor Cores — The Secret Weapon</SectionSubtitle>
            <P>NVIDIA's Tensor Cores (introduced in Volta, 2017) execute a <Strong>4×4 matrix multiply-accumulate (MMA)</Strong> in a single clock cycle at mixed precision (FP16 inputs, FP32 accumulation). GPUs have thousands of these:</P>

            <MathBlock label="tensor core mma" variant="purple">{`  D = A × B + C

  A, B: (4×4) FP16 matrices
  C, D: (4×4) FP32 accumulator

  This is a "WMMA" (Warp Matrix Multiply-Accumulate)
  One tensor core does this in 1 clock cycle.
  H100 has 528 tensor cores × 2GHz × 16 ops/cycle
  = ~989 TFLOPS in FP16`}</MathBlock>

            <SectionSubtitle>CUDA Thread Hierarchy</SectionSubtitle>
            <P>GPUs organize computation in a hierarchy. Understanding this explains how a single matrix multiply maps to hardware:</P>

            <MathBlock label="cuda hierarchy" variant="green">{`  Thread  → executes one FMA (fused multiply-add) operation
  Warp    → 32 threads that execute in lockstep (SIMT)
  Block   → many warps; share fast Shared Memory (~100 KB)
  Grid    → all blocks executing the same kernel

  For a matrix multiply (GEMM):
  • Each thread block computes a TILE of the output matrix
  • Tile is loaded into shared memory (fast!)
  • Inner loop multiplies the tile
  • Result written back to global GPU memory (HBM)`}</MathBlock>

            <GPUFullViz />

            <SectionSubtitle>Memory Hierarchy & Bandwidth</SectionSubtitle>
            <P>The biggest bottleneck in LLM inference isn't compute — it's <Strong>memory bandwidth</Strong>. Reading weights from HBM (high-bandwidth memory) into compute units is the bottleneck:</P>

            <MathBlock label="memory bandwidth math" variant="yellow">{`  Llama-3 70B model:    70 billion params × 2 bytes (FP16)
                      = 140 GB just to store weights

  H100 HBM bandwidth:   3.35 TB/s

  Time to read all weights once:  140 GB / 3.35 TB/s ≈ 42ms

  At 1 token/step, this is your latency floor for 1 token.
  → This is why batching matters: same weight read, more tokens!`}</MathBlock>

            <SectionSubtitle>TPUs — Google's Dedicated Matrix Engine</SectionSubtitle>
            <P>Google's <Strong>Tensor Processing Units</Strong> take specialization further. They're built entirely around matrix multiplication, sacrificing general-purpose computation for raw GEMM performance:</P>

            <MathBlock label="tpu architecture" variant="pink">{`  Core component: Systolic Array
  ┌──────────────────────────────────────────────┐
  │  Matrix data flows through a grid of 256×256 │
  │  multiply-accumulate (MAC) units in a wave.  │
  │  Each MAC unit receives partial results from  │
  │  its neighbor and passes its own along.       │
  │                                              │
  │  TPU v4:  275 TFLOPS (BF16) per chip         │
  │  TPU v4 Pod: 4096 chips → ~1 ExaFLOP!        │
  └──────────────────────────────────────────────┘

  Key advantages over GPU:
  • On-chip HBM closer to compute → less latency
  • Deterministic execution (no warp divergence)
  • Custom network topology (ICI) for pod scaling
  • 4x more energy-efficient for Transformer workloads`}</MathBlock>

            <TPUFullViz />

            <SectionSubtitle>GPU vs TPU — The Architectural Difference</SectionSubtitle>
            <P>The fundamental difference is the data flow model. GPUs <Strong>pull</Strong> data from memory into independent compute blocks. TPUs <Strong>push</Strong> data through a grid of interconnected units in a wave. Run both side by side to see the contrast:</P>

            <GPUvsTPUSideBySide />

            <SectionSubtitle>Precision Formats</SectionSubtitle>
            <P>Not all numbers are equal in AI training. Lower precision = fewer bits = faster multiply + less memory:</P>

            <CompareTable
              headers={['Format', 'Bits', 'Range', 'Use Case']}
              rows={[
                ['FP64 (double)', '64', '±1.8×10³⁰⁸', 'Scientific computing'],
                ['FP32 (single)', '32', '±3.4×10³⁸', 'Gradient accumulation, master weights'],
                ['BF16', '16', 'same as FP32', 'Training (same range, less precision)'],
                ['FP16', '16', '±65,504', 'Inference, tensor core compute'],
                ['INT8', '8', '-128 to 127', 'Quantized inference (2× speed)'],
                ['INT4 / NF4', '4', '16 values', 'QLoRA, edge deployment (4× speed)'],
              ]}
            />

            <SectionSubtitle>Parallelism Strategies for Giant Models</SectionSubtitle>
            <MathBlock label="distributed training" variant="purple">{`  Data Parallelism    — split BATCH across GPUs; same model everywhere
                        GPUs sync gradients after each step (AllReduce)

  Tensor Parallelism  — split WEIGHT MATRICES across GPUs
                        e.g., row 1–2048 on GPU0, row 2049–4096 on GPU1
                        requires AllReduce within every layer

  Pipeline Parallelism — split LAYERS across GPUs
                        GPU0 runs layers 1–24, GPU1 runs 25–48...
                        uses micro-batching to keep GPUs busy

  Expert Parallelism  — each GPU handles different MoE experts
                        only activates a subset of params per token

  GPT-3 used: 8-way tensor × 8-way pipeline × data parallelism
              running on 1024 A100 GPUs`}</MathBlock>
          </section>

          {/* ─── Chapter 9: The Full Stack ─── */}
          <section id="s9" className="py-16">
            <SectionTag>Chapter 09</SectionTag>
            <SectionTitle>The Full Stack: Putting it All Together</SectionTitle>
            <Lead>Every token you generate traces through this entire stack — from characters in a text box to numbers in a matrix to probability distributions sampled into words.</Lead>

            <SectionSubtitle>One Forward Pass, Top to Bottom</SectionSubtitle>

            <FlowDiagram vertical>
              <FlowBox variant="hi"><strong>"Paris is the capital of"</strong><div className="text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0] mt-1">Raw text input</div></FlowBox>
              <FlowArrow vertical />
              <FlowBox>BPE Tokenizer → [9521, 318, 262, 3139, 286]<div className="text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0]">5 token IDs</div></FlowBox>
              <FlowArrow vertical />
              <FlowBox>Embedding matrix lookup + positional encoding<div className="text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0]">→ X of shape (5, 4096)</div></FlowBox>
              <FlowArrow vertical />
              <FlowBox variant="hi2">32 × Transformer Block<div className="text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0]">Each: Q=XWq, K=XWk, V=XWv → Attn(Q,K,V) → FFN → ResNorm</div></FlowBox>
              <FlowArrow vertical />
              <FlowBox>LM head: (5, 4096) × (4096, 32000) → logits (5, 32000)</FlowBox>
              <FlowArrow vertical />
              <FlowBox variant="hi3">Softmax → probabilities → sample last position<div className="text-[0.7rem] text-[#6a6a8a] dark:text-[#9090b0]">→ token 3681 = "France"</div></FlowBox>
            </FlowDiagram>

            <SectionSubtitle>The Numbers Behind "Thinking"</SectionSubtitle>
            <MathBlock label="gpt-4 class model estimates" variant="purple">{`  Parameters:          ~1 Trillion
  Layers:              ~128 transformer blocks
  d_model:             ~12,288
  Attention heads:     ~96
  Context window:      128,000 tokens

  Per-token inference:
    Matrix ops:        ~2T FLOPs
    Memory reads:      ~2 TB from HBM
    Time on H100:      ~15ms per token

  Training compute:    ~10²⁵ FLOPs
  Training time:       ~3 months on ~30,000 H100s
  Training cost:       ~$100 million`}</MathBlock>

            <SectionSubtitle>The Architecture Zoo</SectionSubtitle>
            <CompareTable
              headers={['Model Family', 'Architecture', 'Key Innovation', 'Primary Use']}
              rows={[
                ['ResNet, VGG', 'CNN', 'Skip connections, deep convolutions', 'Image classification'],
                ['LSTM, GRU', 'RNN', 'Gated memory cells', 'Sequential data, NLP (legacy)'],
                ['BERT', 'Encoder Transformer', 'Bidirectional attention, MLM', 'Classification, embedding'],
                ['GPT family', 'Decoder Transformer', 'Causal attention, RLHF', 'Text generation'],
                ['T5, BART', 'Encoder-Decoder', 'Seq2seq with cross-attention', 'Translation, summarization'],
                ['ViT', 'Vision Transformer', 'Image patches as tokens', 'Image understanding'],
                ['Mixtral, GPT-4', 'MoE Transformer', 'Sparse expert routing', 'Efficient LLM at scale'],
                ['Mamba, RWKV', 'State Space Models', 'Linear complexity attention alternatives', 'Long context, efficiency'],
              ]}
            />

            <Callout type="insight">Every model in this table — from the simplest CNN to the largest LLM — ultimately reduces to the same primitive operation: multiply two matrices, add them together, apply a non-linearity. <Strong>The miracle of deep learning is that this simple operation, composed deeply enough, with enough data, gives rise to everything from edge detection to reasoning about the world.</Strong></Callout>

            <Callout type="gpu">The hardware race is fundamentally a race to multiply larger matrices faster. NVIDIA H100 → H200 → Blackwell B200 are all improvements in one metric: how many FP8/FP16 multiply-accumulate operations can we execute per second, and how fast can we feed them with memory bandwidth.</Callout>
          </section>

        </motion.div>

        {/* Analytics Section */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.4 }} className="mt-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-white/50 dark:bg-[#001F3F]/30 border border-[#001F3F]/10 dark:border-white/10 rounded-lg">
            <div className="flex flex-col sm:flex-row items-center gap-4 flex-1">
              <ActiveViewers count={activeUsers} />
              <PageStats viewCount={analytics?.view_count} likeCount={analytics?.like_count} />
            </div>
            <LikeButton pageId={pageId} likeCount={analytics?.like_count} />
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.5 }} className="mt-8 pt-8 border-t border-[#001F3F]/10 dark:border-white/10">
          <Link to="/blog" className="inline-flex items-center space-x-2 text-[#001F3F] dark:text-white hover:opacity-70 transition-opacity">
            <ArrowLeft className="w-5 h-5" /><span>Back to Blog</span>
          </Link>
        </motion.div>
      </article>
    </div>
  );
};

export default MatmulTutorial;
