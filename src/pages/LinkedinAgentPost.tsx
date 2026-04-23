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
    <div className={`relative bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] border-l-[3px] ${borderColors[variant]} rounded-lg p-6 my-6 font-['DM_Mono',monospace] text-[0.9rem] overflow-x-auto`}>
      <span className={`absolute -top-px right-3 text-[0.6rem] tracking-[0.15em] uppercase ${labelBgs[variant]} text-black px-2 py-0.5 rounded-b font-medium`}>{label}</span>
      <pre className="whitespace-pre text-[#001F3F] dark:text-[#e8e8f0] overflow-x-auto">{children}</pre>
    </div>
  );
};

const Callout = ({ type, children }: { type: 'insight' | 'warning' | 'gpu'; children: React.ReactNode }) => {
  const styles = {
    insight: { bg: 'bg-[#7c6aff]/5 dark:bg-[#7c6aff]/[0.08]', border: 'border-[#7c6aff]', prefix: '◆ Insight — ', color: 'text-[#7c6aff]' },
    warning: { bg: 'bg-[#ff6a9a]/5 dark:bg-[#ff6a9a]/[0.08]', border: 'border-[#ff6a9a]', prefix: '⚡ Lesson — ', color: 'text-[#ff6a9a]' },
    gpu: { bg: 'bg-[#6affe0]/5 dark:bg-[#6affe0]/[0.08]', border: 'border-[#6affe0]', prefix: '✓ Result — ', color: 'text-[#6affe0]' },
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

const Em = ({ children }: { children: React.ReactNode }) => (
  <em className="text-[#7c6aff] not-italic font-medium">{children}</em>
);

const UL = ({ children }: { children: React.ReactNode }) => (
  <ul className="list-disc ml-6 mb-5 space-y-2 text-[#4a4a6a] dark:text-[#9090b0] text-base leading-relaxed marker:text-[#7c6aff]">{children}</ul>
);

const OL = ({ children }: { children: React.ReactNode }) => (
  <ol className="list-decimal ml-6 mb-5 space-y-3 text-[#4a4a6a] dark:text-[#9090b0] text-base leading-relaxed marker:text-[#7c6aff] marker:font-['DM_Mono',monospace]">{children}</ol>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="font-['DM_Mono',monospace] text-[0.85em] px-1.5 py-0.5 rounded bg-[#7c6aff]/10 text-[#7c6aff] border border-[#7c6aff]/20">{children}</code>
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

// ─── Interactive: 9-Stage Pipeline Animation ───

const PIPELINE_STAGES = [
  { id: 'search',  label: '01 · Search',          desc: 'Keyword query → headline-tier scoring',            caption: 'Search · keyword query → headline-tier scoring' },
  { id: 'enrich',  label: '02 · Enrich',          desc: 'Full profile → re-score with complete data',       caption: 'Enrich · full profile fetch → re-score; some upgrade to high priority' },
  { id: 'email',   label: '03 · Find Email',      desc: '18-pattern guess → mail-server validate → API fallback', caption: 'Find Email · 18 pattern guesses → mail-server validate → API fallback' },
  { id: 'gen',     label: '04 · Generate',        desc: '6-stage LLM pipeline, best-of-N',                  caption: 'Generate · 6-stage LLM pipeline → 3 attempts → best-of-N' },
  { id: 'review',  label: '05 · Review',          desc: 'Interactive CLI · approve / edit / rewrite',        caption: 'Review · interactive CLI → approve, edit inline, or full rewrite' },
  { id: 'sched',   label: '06 · Schedule',        desc: 'Activity-pattern timing in local TZ',              caption: 'Schedule · per-recipient activity histogram → evening or morning local' },
  { id: 'send',    label: '07 · Send',            desc: 'Email + LinkedIn invite fire together (Touch 1)',  caption: 'Send · email + LinkedIn connection request fire together' },
  { id: 'follow',  label: '08 · Follow Up',       desc: 'Touch 2 (day 7) + Touch 3 (day 14) auto-drafted',  caption: 'Follow Up · Touch 2 day 7 (short, new detail) → Touch 3 day 14 (graceful exit)' },
  { id: 'reply',   label: '09 · Reply Handling',  desc: 'Webhook → LLM draft → email approval → DM',        caption: 'Reply Handling · webhook → LLM draft → Gmail notification → IMAP poll → DM' },
];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const PipelineAnimation = () => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [doneIdx, setDoneIdx] = useState<Set<number>>(new Set());
  const [caption, setCaption] = useState('Click Animate to walk through the nine pipeline stages.');
  const [btnText, setBtnText] = useState('▶ Animate');
  const running = useRef(false);

  const runAnim = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBtnText('⏸');
    setActiveIdx(null);
    setDoneIdx(new Set());

    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      setActiveIdx(i);
      setCaption(PIPELINE_STAGES[i].caption);
      await sleep(900);
      setDoneIdx(prev => new Set([...prev, i]));
      await sleep(150);
    }

    setActiveIdx(null);
    setCaption('Pipeline complete — 9 stages, profile → email → reply, all gated by human review.');
    setBtnText('↺ Replay');
    running.current = false;
  }, []);

  return (
    <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl overflow-hidden my-8">
      <div className="bg-[#e8e8f0] dark:bg-[#16162a] px-6 py-4 border-b border-[#d0d0e0] dark:border-[#2a2a45] flex items-center justify-between">
        <span className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.15em] uppercase text-[#7c6aff]">Interactive · 9-Stage Pipeline</span>
        <button onClick={runAnim} className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.1em] uppercase px-5 py-2 border border-[#7c6aff] rounded-md bg-transparent text-[#7c6aff] cursor-pointer hover:bg-[#7c6aff]/[0.15] transition-all">{btnText}</button>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {PIPELINE_STAGES.map((s, i) => {
            const isActive = activeIdx === i;
            const isDone = doneIdx.has(i);
            let cls = 'rounded-lg border px-3 py-3 transition-all duration-300 ';
            if (isActive) cls += 'border-[#7c6aff] bg-[#7c6aff]/[0.18] shadow-[0_0_12px_rgba(124,106,255,0.35)]';
            else if (isDone) cls += 'border-[#6affe0] bg-[#6affe0]/[0.10]';
            else cls += 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#0d0d18]';
            return (
              <div key={s.id} className={cls}>
                <div className={`font-['DM_Mono',monospace] text-[0.7rem] tracking-[0.1em] uppercase mb-1 ${isActive ? 'text-[#7c6aff]' : isDone ? 'text-[#5a9a8a] dark:text-[#6affe0]' : 'text-[#9a9ab0] dark:text-[#505070]'}`}>
                  {s.label}
                </div>
                <div className="font-['DM_Sans',sans-serif] text-[0.72rem] text-[#6a6a8a] dark:text-[#9090b0] leading-snug">
                  {s.desc}
                </div>
              </div>
            );
          })}
        </div>
        <div className="font-['DM_Mono',monospace] text-[0.78rem] text-[#6a6a8a] dark:text-[#9090b0] text-center min-h-[2.5rem] mt-5 px-2">{caption}</div>
      </div>
    </div>
  );
};

// ─── Interactive: Reply Approval Flow ───

type ReplyPhase = 'idle' | 'incoming' | 'webhook' | 'drafting' | 'notify' | 'decide_w' | 'rewrite' | 'notify2' | 'decide_w2' | 'rewrite2' | 'notify3' | 'decide_a' | 'sending' | 'done';

const REPLY_PALETTES = {
  purple: { active: 'border-[#7c6aff] bg-[#7c6aff]/[0.18] shadow-[0_0_10px_rgba(124,106,255,0.4)] text-[#7c6aff]', done: 'border-[#6affe0] bg-[#6affe0]/[0.10] text-[#5a9a8a] dark:text-[#6affe0]' },
  pink:   { active: 'border-[#ff6a9a] bg-[#ff6a9a]/[0.18] shadow-[0_0_10px_rgba(255,106,154,0.4)] text-[#ff6a9a]', done: 'border-[#6affe0] bg-[#6affe0]/[0.10] text-[#5a9a8a] dark:text-[#6affe0]' },
  teal:   { active: 'border-[#6affe0] bg-[#6affe0]/[0.18] shadow-[0_0_10px_rgba(106,255,224,0.4)] text-[#5a9a8a] dark:text-[#6affe0]', done: 'border-[#6affe0] bg-[#6affe0]/[0.10] text-[#5a9a8a] dark:text-[#6affe0]' },
  yellow: { active: 'border-[#ffc96a] bg-[#ffc96a]/[0.18] shadow-[0_0_10px_rgba(255,201,106,0.4)] text-[#b8860b] dark:text-[#ffc96a]', done: 'border-[#6affe0] bg-[#6affe0]/[0.10] text-[#5a9a8a] dark:text-[#6affe0]' },
} as const;

const ReplyBox = ({ active, done, label, sub, accent = 'purple' }: { active?: boolean; done?: boolean; label: string; sub?: string; accent?: keyof typeof REPLY_PALETTES }) => {
  const p = REPLY_PALETTES[accent];
  let cls = 'rounded-lg border px-3 py-3 transition-all duration-300 text-center font-["DM_Mono",monospace] text-[0.72rem] ';
  if (active) cls += p.active;
  else if (done) cls += p.done;
  else cls += 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#0d0d18] text-[#9a9ab0] dark:text-[#505070]';
  return (
    <div className={cls}>
      <div className="leading-tight">{label}</div>
      {sub && <div className="text-[0.6rem] mt-1 opacity-70 font-['DM_Sans',sans-serif]">{sub}</div>}
    </div>
  );
};

const ReplyArr = ({ on, dir = 'down' }: { on?: boolean; dir?: 'down' | 'up' | 'right' }) => (
  <div className={`flex justify-center text-base transition-colors ${on ? 'text-[#7c6aff]' : 'text-[#6a6a8a] dark:text-[#9090b0]'}`}>
    {dir === 'down' ? '↓' : dir === 'up' ? '↑' : '→'}
  </div>
);

const ReplyApprovalAnimation = () => {
  const [phase, setPhase] = useState<ReplyPhase>('idle');
  const [draftVersion, setDraftVersion] = useState(0);
  const [decision, setDecision] = useState<'a' | 'e' | 'w' | null>(null);
  const [caption, setCaption] = useState('Click Animate to watch a LinkedIn reply land, get drafted, and approved over email.');
  const [btnText, setBtnText] = useState('▶ Animate');
  const running = useRef(false);

  const runAnim = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBtnText('⏸');
    setPhase('idle'); setDraftVersion(0); setDecision(null);
    await sleep(150);

    setPhase('incoming'); setCaption('A recipient replies on LinkedIn → webhook fires'); await sleep(900);
    setPhase('webhook'); setCaption('Background worker receives the message — filters strangers, dedupes by message id'); await sleep(1100);
    setPhase('drafting'); setDraftVersion(1); setCaption('Claude Sonnet drafts a reply (acknowledge → steer to 15-min call → ≤ 500 chars, no emoji)'); await sleep(1200);
    setPhase('notify'); setCaption('Notification email sent: thread + draft v1 + a/e/w legend'); await sleep(1100);

    // First w cycle
    setPhase('decide_w'); setDecision('w'); setCaption('I reply: "w, make it shorter and lead with their k8s post"'); await sleep(1100);
    setPhase('rewrite'); setDraftVersion(2); setCaption('Pipeline rewrites with my feedback → draft v2'); await sleep(1100);
    setPhase('notify2'); setCaption('New notification email lands with draft v2 — latest rewrite wins'); await sleep(1100);

    // Second w cycle
    setPhase('decide_w2'); setDecision('w'); setCaption('I reply: "w, drop the second sentence"'); await sleep(1000);
    setPhase('rewrite2'); setDraftVersion(3); setCaption('Pipeline rewrites again → draft v3 (the w command is recursive)'); await sleep(1100);
    setPhase('notify3'); setCaption('Notification email with draft v3'); await sleep(1000);

    // Approve
    setPhase('decide_a'); setDecision('a'); setCaption('I reply: "a" — send the drafted reply as-is'); await sleep(1000);
    setPhase('sending'); setCaption('Worker posts the latest stored draft to the LinkedIn DM API → marked sent'); await sleep(1100);
    setPhase('done'); setCaption('Confirmation email back to me. Loop closed without ever opening LinkedIn or the CLI.'); await sleep(200);

    setBtnText('↺ Replay');
    running.current = false;
  }, []);

  const isOn = (...phases: ReplyPhase[]) => phases.includes(phase);
  const passed = (target: ReplyPhase) => {
    const order: ReplyPhase[] = ['idle','incoming','webhook','drafting','notify','decide_w','rewrite','notify2','decide_w2','rewrite2','notify3','decide_a','sending','done'];
    return order.indexOf(phase) >= order.indexOf(target);
  };

  return (
    <div className="bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl overflow-hidden my-8">
      <div className="bg-[#e8e8f0] dark:bg-[#16162a] px-6 py-4 border-b border-[#d0d0e0] dark:border-[#2a2a45] flex items-center justify-between">
        <span className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.15em] uppercase text-[#ff6a9a]">Interactive · Reply Approval Flow</span>
        <button onClick={runAnim} className="font-['DM_Mono',monospace] text-[0.75rem] tracking-[0.1em] uppercase px-5 py-2 border border-[#ff6a9a] rounded-md bg-transparent text-[#ff6a9a] cursor-pointer hover:bg-[#ff6a9a]/[0.15] transition-all">{btnText}</button>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Left column: ingest + draft */}
          <div className="space-y-2">
            <ReplyBox active={isOn('incoming')} done={passed('webhook')} label="LinkedIn reply" sub="recipient replies on connection" accent="pink" />
            <ReplyArr on={isOn('incoming','webhook')} />
            <ReplyBox active={isOn('webhook')} done={passed('drafting')} label="Webhook receiver" sub="incoming message · filter + dedupe" />
            <ReplyArr on={isOn('webhook','drafting')} />
            <ReplyBox active={isOn('drafting','rewrite','rewrite2')} done={passed('notify3')} label={`LLM draft v${draftVersion || '—'}`} sub="Claude Sonnet · ≤ 500 chars" />
            <ReplyArr on={isOn('drafting','rewrite','rewrite2','notify','notify2','notify3')} />
            <ReplyBox active={isOn('notify','notify2','notify3')} done={passed('decide_a')} label="Gmail notification" sub="thread + draft + commands" accent="yellow" />
          </div>

          {/* Right column: decision + send */}
          <div className="space-y-2">
            <div className="rounded-lg border border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#0d0d18] p-3">
              <div className="font-['DM_Mono',monospace] text-[0.65rem] tracking-[0.15em] uppercase text-[#6a6a8a] dark:text-[#9090b0] mb-2">My email reply (a / e / w)</div>
              <div className="grid grid-cols-3 gap-2">
                <div className={`text-center font-['DM_Mono',monospace] text-[0.75rem] py-2 rounded border transition-all ${decision === 'a' && isOn('decide_a') ? 'border-[#6affe0] bg-[#6affe0]/[0.18] text-[#5a9a8a] dark:text-[#6affe0] shadow-[0_0_8px_rgba(106,255,224,0.4)]' : 'border-[#d0d0e0] dark:border-[#2a2a45] text-[#9a9ab0] dark:text-[#505070]'}`}>
                  a<div className="text-[0.55rem] opacity-70">approve</div>
                </div>
                <div className={`text-center font-['DM_Mono',monospace] text-[0.75rem] py-2 rounded border transition-all ${decision === 'e' ? 'border-[#ffc96a] bg-[#ffc96a]/[0.18] text-[#b8860b] dark:text-[#ffc96a] shadow-[0_0_8px_rgba(255,201,106,0.4)]' : 'border-[#d0d0e0] dark:border-[#2a2a45] text-[#9a9ab0] dark:text-[#505070]'}`}>
                  e<div className="text-[0.55rem] opacity-70">edit</div>
                </div>
                <div className={`text-center font-['DM_Mono',monospace] text-[0.75rem] py-2 rounded border transition-all ${decision === 'w' && isOn('decide_w','decide_w2') ? 'border-[#7c6aff] bg-[#7c6aff]/[0.18] text-[#7c6aff] shadow-[0_0_8px_rgba(124,106,255,0.4)]' : 'border-[#d0d0e0] dark:border-[#2a2a45] text-[#9a9ab0] dark:text-[#505070]'}`}>
                  w<div className="text-[0.55rem] opacity-70">rewrite</div>
                </div>
              </div>
              <div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0] mt-3 font-['DM_Sans',sans-serif] leading-snug">
                <span className="font-['DM_Mono',monospace] text-[#7c6aff]">w</span> is recursive — keeps cycling LLM Draft → Notification until I send <span className="font-['DM_Mono',monospace] text-[#6affe0]">a</span> or <span className="font-['DM_Mono',monospace] text-[#ffc96a]">e</span>.
              </div>
            </div>

            <div className="flex justify-center">
              <span className={`text-base ${isOn('decide_w','decide_w2','rewrite','rewrite2') ? 'text-[#7c6aff]' : 'text-[#6a6a8a] dark:text-[#9090b0]'}`}>↺ rewrite loop</span>
            </div>

            <ReplyBox active={isOn('sending')} done={isOn('done')} label="LinkedIn DM send" sub="send approved reply" accent="teal" />
            <ReplyArr on={isOn('sending','done')} />
            <ReplyBox active={isOn('done')} done={isOn('done')} label="message sent" sub="confirmation email back to me" accent="teal" />
          </div>
        </div>

        <div className="font-['DM_Mono',monospace] text-[0.78rem] text-[#6a6a8a] dark:text-[#9090b0] text-center min-h-[2.5rem] mt-6 px-2">{caption}</div>
      </div>
    </div>
  );
};

// ─── Table of Contents ───

const TOC_ITEMS = [
  { id: 's1',  label: '01 · What It Does' },
  { id: 's2',  label: '02 · Architecture' },
  { id: 's3',  label: '03 · Tech Stack' },
  { id: 's4',  label: '04 · LLM Pipeline' },
  { id: 's5',  label: '05 · Reply Handling' },
  { id: 's6',  label: '06 · Email Verification' },
  { id: 's7',  label: '07 · Scoring' },
  { id: 's8',  label: '08 · Scheduling' },
  { id: 's9',  label: '09 · LinkedIn-Only Path' },
  { id: 's10', label: '10 · Background Worker' },
  { id: 's11', label: '11 · Problems Solved' },
  { id: 's12', label: '12 · Results' },
  { id: 's13', label: '13 · What\'s Next' },
];

// ─── Main Page Component ───

const LinkedinAgentPost = () => {
  const { pageId, activeUsers, analytics } = usePageAnalytics('LinkedIn Outreach Agent');

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
            Engineering Case Study
          </div>
          <h1 className="font-['Playfair_Display',serif] text-[clamp(2.2rem,6vw,4rem)] font-black leading-[1.05] tracking-tight text-[#001F3F] dark:text-white">
            I Built an AI Agent That Writes<br />Cold Emails People <Em>Actually</Em> Reply To
          </h1>
          <p className="text-lg text-[#001F3F]/70 dark:text-white/70 max-w-2xl leading-relaxed">
            Discover, validate, generate, schedule, send, follow up, and handle replies — without ever reading like cold outreach.
          </p>
          <p className="text-sm text-[#001F3F]/60 dark:text-white/60">Author: Nikhil Kulkarni</p>
          <div className="flex flex-wrap items-center gap-4 text-[#001F3F]/60 dark:text-white/60">
            <div className="flex items-center space-x-2"><Calendar className="w-4 h-4" /><span>April 22, 2026</span></div>
            <div className="flex items-center space-x-2"><Clock className="w-4 h-4" /><span>18 min read</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Cold Outreach', 'Claude Sonnet', 'PostgreSQL', 'FastAPI', 'Gmail SMTP/IMAP'].map(tag => (
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

          {/* ─── Opening (no section header) ─── */}
          <section className="py-12 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <Lead>Cold outreach doesn't work when it reads like cold outreach. Templates get ignored. Mass personalization tools produce emails that feel AI-generated because they are. The recipient can tell in two seconds.</Lead>
            <P>I needed a system that generates emails indistinguishable from ones I'd write by hand — but at 10x the throughput. Each email had to reference something specific the recipient actually did (a post, a product, a technical decision), match their communication style, and pass my own review before sending.</P>
            <P>The alternative was spending 30-45 minutes per person researching their profile, writing a personalized email, finding their email address, and scheduling the send. At that rate, reaching 100 people takes a month of full-time work. This system does the same quality in minutes per person, with me as the final quality gate.</P>
          </section>

          {/* ─── 01 · What It Does ─── */}
          <section id="s1" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 01</SectionTag>
            <SectionTitle>What It Does</SectionTitle>
            <Lead>End-to-end pipeline from "find people on LinkedIn" to "email lands in their inbox at the right time," with reply handling that lets me manage conversations from my phone.</Lead>

            <P><Strong>Input:</Strong> A search query (e.g., "Engineering Manager agentic AI") and a target location.<br /><Strong>Output:</Strong> Personalized emails + LinkedIn connection notes, reviewed and scheduled, with multi-touch follow-ups and reply handling via an email-based approval workflow.</P>

            <P>Nine stages:</P>

            <OL>
              <li><Strong>Search</Strong> — Find relevant profiles via keyword queries. Score immediately on headline keywords using a three-tier weighted system.</li>
              <li><Strong>Enrich</Strong> — Fetch full profiles: work history, about section, posts, comments, skills. Re-score with complete data.</li>
              <li><Strong>Find Email</Strong> — Pattern-guess email addresses (18 patterns per person), validate against the recipient's mail server, fall back to a verification API for high-priority failures. Profiles with no verified email get routed to a LinkedIn-only path.</li>
              <li><Strong>Generate</Strong> — Six-stage LLM pipeline produces a personalized email + LinkedIn connection note. Three attempts, best-of-N selection.</li>
              <li><Strong>Review</Strong> — Interactive CLI. I see the full profile context alongside the draft. Approve, edit inline, or trigger a full rewrite. Nothing sends without my approval.</li>
              <li><Strong>Schedule</Strong> — Each email gets a send time based on when the recipient is active on LinkedIn (inferred from their post/comment timestamps, converted to their local timezone). Evening-active people get scheduled for evening; everyone else gets morning. Sends spread across weekdays with daily caps.</li>
              <li><Strong>Send</Strong> — Email + LinkedIn connection request fire together for Touch 1. LinkedIn-only sends fire connection invites separately.</li>
              <li><Strong>Follow Up</Strong> — Background scheduler creates Touch 2 (day 7) and Touch 3 (day 14) drafts automatically. Each touch has different rules: Touch 2 is short with a new detail; Touch 3 offers a graceful exit.</li>
              <li><Strong>Reply Handling</Strong> — When a recipient replies on LinkedIn, a webhook captures the message, the system drafts a response via LLM, and emails me the conversation thread with the drafted reply. I reply to the email with a single command to approve, edit, or request a rewrite.</li>
            </OL>

            <PipelineAnimation />
          </section>

          {/* ─── 02 · Architecture ─── */}
          <section id="s2" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 02</SectionTag>
            <SectionTitle>Architecture</SectionTitle>

            <MathBlock label="system topology" variant="purple">{`LinkedIn API
    |
    v
Search → Enrich → Score → Find Email → Generate (LLM) → Review (CLI) → Schedule → Send
    |                          |              |                                      |
    v                          v              v                                      v
PostgreSQL              Email Validator   Claude/GPT-4                         Gmail SMTP
(profiles, touches,     (pattern check    (6-stage                            + LinkedIn API
 send logs)              + API fallback)   pipeline)                          (connection
                                                                              invites)

                    LinkedIn Webhook
                         |
                         v
                  Background Worker
                  (webhook receiver, reply drafting,
                   IMAP polling, message sending)
                         |
                    Gmail SMTP
                    (notification + approval emails)
                         |
                         v
                    Gmail IMAP
                    (polls for a/e/w reply commands)
                         |
                         v
                    LinkedIn API
                    (sends approved replies)`}</MathBlock>

            <P><Strong>No web UI.</Strong> Everything runs through a CLI and email. The review step is interactive in the terminal. Reply approval happens entirely through Gmail. Drafts are stored in a JSON file alongside the database for fast iteration.</P>
          </section>

          {/* ─── 03 · Tech Stack ─── */}
          <section id="s3" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 03</SectionTag>
            <SectionTitle>Tech Stack</SectionTitle>
            <CompareTable
              headers={['Layer', 'Technology']}
              rows={[
                ['LLM', 'Anthropic Claude Sonnet (primary), OpenAI GPT-4o (fallback)'],
                ['LinkedIn API', 'Third-party integration for search, profile fetch, posts/comments, connection invites, DMs, webhooks'],
                ['Email verification', 'Pattern matching + API validation'],
                ['Email sending', 'Gmail SMTP (port 587, app password, STARTTLS)'],
                ['Email reading', 'Gmail IMAP (polling for reply approval commands)'],
                ['Scheduling', 'Background worker with SQLite queue, polls every 60s'],
                ['Reply handling', 'Webhook → worker → LLM draft → Gmail notification → IMAP poll → DM API'],
                ['Database', 'PostgreSQL with SQLAlchemy ORM, JSONB for raw profiles'],
                ['Background jobs', 'APScheduler for follow-up draft creation'],
                ['Language', 'Python. No framework. stdlib where possible.'],
                ['Infra', 'VPS (email validation + scheduled sending + reply handling), local Mac (CLI + review)'],
              ]}
            />
          </section>

          {/* ─── 04 · The LLM Pipeline (Six Stages) ─── */}
          <section id="s4" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 04</SectionTag>
            <SectionTitle>The LLM Pipeline (Six Stages)</SectionTitle>
            <Lead>This is where most of the complexity lives. Each email goes through six stages. If quality checks fail, the pipeline retries up to three times with feedback from previous failures.</Lead>

            <FlowDiagram>
              <FlowBox variant="hi">Stage 1<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">Profile Intel</div></FlowBox>
              <FlowArrow />
              <FlowBox variant="hi">Stage 2<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">Angle Score</div></FlowBox>
              <FlowArrow />
              <FlowBox variant="hi2">Stage 3<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">Style Examples</div></FlowBox>
              <FlowArrow />
              <FlowBox variant="hi3">Stage 4<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">Constrained Gen</div></FlowBox>
              <FlowArrow />
              <FlowBox>Stage 5<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">LLM Detection</div></FlowBox>
              <FlowArrow />
              <FlowBox>Stage 6<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">Time Check</div></FlowBox>
              <FlowArrow />
              <FlowBox variant="hi2">✓ Send<div className="text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">or retry → S4</div></FlowBox>
            </FlowDiagram>

            <SectionSubtitle>Stage 1 — Profile Intelligence Extraction</SectionSubtitle>
            <P>LLM reads the full profile (headline, about, experience, posts, comments) and outputs structured JSON: what they're working on, their career trajectory, specific overlaps with my background, their communication style, and one "resonance anchor" — a concrete detail about their work that becomes the bold highlight in the email.</P>

            <SectionSubtitle>Stage 2 — Angle Generation and Scoring</SectionSubtitle>
            <P>LLM generates 4-5 outreach angles, each scored on specificity (would this apply to 100 other people?), relevance (is there a natural reason for me to reach out?), and warmth (would this make them want to respond?). Highest-scoring angle wins.</P>

            <SectionSubtitle>Stage 3 — Style Example Retrieval</SectionSubtitle>
            <P>The pipeline picks 2-3 reference emails from a curated set of real emails I've sent. Selected by angle similarity to give the generator concrete examples of my voice.</P>

            <SectionSubtitle>Stage 4 — Constrained Generation</SectionSubtitle>
            <P>The core generation step. A structural template enforces a 3-sentence format:</P>
            <UL>
              <li><Strong>Sentence 1</Strong> states what I built (specific project details, no hedging).</li>
              <li><Strong>Sentence 2</Strong> names one specific thing about the recipient (their post topic, their company's work, their career move, or their domain) with one <Strong>bolded</Strong> detail.</li>
              <li><Strong>Sentence 3</Strong> asks for 15 minutes on a specific topic.</li>
            </UL>
            <P>Then sign-off with name and two links. No filler, no flattery, no bridge paragraphs. A banned-phrases list blocks 27+ anti-patterns including "I'd love to connect", "swap notes", "resonated with me", "impressive", "caught my eye."</P>

            <SectionSubtitle>Stage 5 — LLM Detection Check</SectionSubtitle>
            <P>A separate LLM call scores the draft 1-10 on how obviously AI-generated it reads. Checks for formulaic structure, AI tells, unnaturally smooth transitions, symmetrical paragraph lengths. Threshold: score &lt; 7 to pass.</P>

            <SectionSubtitle>Stage 6 — Respect-Their-Time Check</SectionSubtitle>
            <P>The LLM role-plays as the recipient ("You get 50+ emails a day") and evaluates: Would you read past the first line? Is the ask clear? Did the sender earn the right to ask? Is there filler? Emails with filler sentences or unclear asks fail.</P>

            <SectionSubtitle>Retry Logic</SectionSubtitle>
            <P>If either check fails, the pipeline feeds the specific failure (flagged phrases, filler sentences) back into Stage 4 as additional constraints and regenerates. Up to 3 total attempts. If none pass cleanly, the system picks the best-scoring attempt — a composite of LLM detection score + time-check penalty.</P>
          </section>

          {/* ─── 05 · Reply Handling ─── */}
          <section id="s5" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 05</SectionTag>
            <SectionTitle>Reply Handling</SectionTitle>
            <Lead>When someone replies to a connection request, the system needs to close the loop — draft a contextual response, get my approval, and send it — without me opening LinkedIn or the CLI.</Lead>

            <SectionSubtitle>How It Works</SectionSubtitle>
            <P>A webhook fires when any LinkedIn message arrives. The handler:</P>

            <OL>
              <li><Strong>Filters</Strong> — Checks the sender against tracked contacts (people the system has sent connection requests to). Messages from strangers are ignored.</li>
              <li><Strong>Deduplicates</Strong> — Checks message ID to avoid processing the same message twice.</li>
              <li><Strong>Fetches conversation</Strong> — Pulls the full thread, not just the latest message.</li>
              <li><Strong>Drafts a reply</Strong> — Calls Claude Sonnet with the conversation thread, contact name, and company. The system prompt tells the LLM to: acknowledge what they said specifically, steer toward a 15-minute call, suggest specific availability, stay under 500 characters, and sound like a real person — no emojis, no exclamation marks, direct and respectful.</li>
              <li><Strong>Stores</Strong> — Saves the draft with version tracking and a <Code>pending</Code> status.</li>
              <li><Strong>Notifies</Strong> — Sends me a Gmail with the conversation thread, the drafted reply, and instructions.</li>
            </OL>

            <ReplyApprovalAnimation />

            <SectionSubtitle>The Email Approval Protocol</SectionSubtitle>
            <P>The notification email looks like:</P>

            <MathBlock label="notification email" variant="yellow">{`[Name] @ [Company] replied on LinkedIn.

CONVERSATION:
[full thread with timestamps]

DRAFTED REPLY:
[LLM-generated response]

---
Reply to this email:
  a — send drafted reply as-is
  e, [your text] — send your version instead
  w, [feedback] — rewrite with AI and email you again`}</MathBlock>

            <P>Three commands:</P>

            <UL>
              <li><Strong><Code>a</Code></Strong> — Send the draft as-is. Confirms via email.</li>
              <li><Strong><Code>e, [text]</Code></Strong> — Send my exact text instead. Confirms.</li>
              <li><Strong><Code>w, [feedback]</Code></Strong> — Rewrite the draft using my feedback (e.g., "make it shorter", "angle should be about their k8s work"). Sends me a new email with the rewrite for another round.</li>
            </UL>

            <P>The <Code>w</Code> command is recursive — I can keep refining until I'm satisfied. The system only sends a message when it sees <Code>a</Code> or <Code>e</Code>. This means I can manage LinkedIn conversations entirely from my Gmail inbox, including from my phone.</P>

            <SectionSubtitle>IMAP Polling</SectionSubtitle>
            <P>A background task polls Gmail IMAP every 5 minutes, searching for replies to notification emails. It extracts the command from the first non-quoted line of the reply, looks up the corresponding conversation, and executes. Simple UID tracking avoids reprocessing.</P>
          </section>

          {/* ─── 06 · Email Verification ─── */}
          <section id="s6" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 06</SectionTag>
            <SectionTitle>Email Verification</SectionTitle>
            <Lead>Finding someone's email address is a solved problem. Knowing if that address actually works is not.</Lead>

            <P>The pipeline generates 18 pattern guesses per person (<Code>first.last@</Code>, <Code>firstlast@</Code>, <Code>f.last@</Code>, etc.) and validates them against the recipient's mail server. This runs on a VPS because it requires network access that most cloud providers restrict.</P>

            <P>The validator distinguishes three outcomes:</P>

            <UL>
              <li><Strong>Valid</Strong> (server confirms the mailbox exists, not a catch-all domain): high confidence.</li>
              <li><Strong>Catch-all</Strong> (server accepts everything — common at large enterprises): pattern is plausible but unverifiable. Lower confidence.</li>
              <li><Strong>Rejected</Strong> (server explicitly says the mailbox doesn't exist): skip.</li>
            </UL>

            <P>Catch-all domains are common at large enterprises. For these, a verification API serves as a secondary signal. If it confirms the pattern with reasonable confidence, it's used. If both methods fail, the profile falls to the LinkedIn-only path — a 300-character connection note generated by a lightweight version of the pipeline.</P>
          </section>

          {/* ─── 07 · Scoring ─── */}
          <section id="s7" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 07</SectionTag>
            <SectionTitle>Scoring</SectionTitle>
            <Lead>Three-tier keyword matching on profile text.</Lead>

            <CompareTable
              headers={['Tier', 'Points', 'Keywords']}
              rows={[
                ['Tier 1', '3 points', 'agentic, ai agent, agent framework, multi-agent, langchain, langgraph, platform engineering, model serving, mcp — the core terms that signal someone works in the space I want to be in.'],
                ['Tier 2', '2 points', 'rag, vector database, mlops, kubernetes, fine-tuning, inference, tool use — adjacent but not direct.'],
                ['Tier 3', '1 point', 'openai, anthropic, generative ai, python, distributed systems — broad signals.'],
              ]}
            />

            <P>Score &gt;= 6 is "high" priority. 3-5 is "medium." Below 3 is archived. Scoring runs twice: once on headline during discovery (fast filter), again on the full profile after enrichment (can upgrade medium to high).</P>
          </section>

          {/* ─── 08 · Activity-Pattern Scheduling ─── */}
          <section id="s8" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 08</SectionTag>
            <SectionTitle>Activity-Pattern Scheduling</SectionTitle>

            <P>Every person's LinkedIn posts and comments have timestamps. The pipeline converts these to the recipient's local timezone (inferred from their location string) and builds a histogram of their activity by hour.</P>

            <P>If &gt;= 30% of their activity falls between 5-10 PM local time, they're flagged as evening-active and scheduled for 6:00-7:30 PM in their timezone. Everyone else defaults to 9:30 AM local with jitter.</P>

            <P>Sends are restricted to weekdays. Monday is skipped where possible (emails get buried in weekend catch-up). Connection requests are spread with gaps between sends and capped per day to stay within platform limits. Requires a minimum of 5 data points before trusting the evening signal; below that, defaults to morning.</P>
          </section>

          {/* ─── 09 · LinkedIn-Only Path ─── */}
          <section id="s9" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 09</SectionTag>
            <SectionTitle>LinkedIn-Only Path</SectionTitle>

            <P>For profiles where no email can be verified, the system generates a LinkedIn-only connection note.</P>

            <P>This uses stages 1 and 2 of the full pipeline (profile extraction + angle scoring) plus a lightweight note generator tuned for the 300-character limit. No greeting (LinkedIn frames it), no sign-off (your name shows automatically), no links (LinkedIn strips them), no markdown, no emojis. Two sentences: what I built plus the one thing about them that's relevant, then the ask. Anti-flattery rules apply.</P>
          </section>

          {/* ─── 10 · The Background Worker ─── */}
          <section id="s10" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 10</SectionTag>
            <SectionTitle>The Background Worker</SectionTitle>

            <P>A FastAPI service in Docker handles everything requiring persistent background execution:</P>

            <SectionSubtitle>Scheduling endpoints (auth required)</SectionSubtitle>
            <UL>
              <li>Schedule email sends, LinkedIn connections, and DMs</li>
              <li>List, cancel, and manage pending sends</li>
              <li>Daily send quotas and caps</li>
            </UL>

            <SectionSubtitle>Reply handling endpoints</SectionSubtitle>
            <UL>
              <li>Webhook receiver for incoming LinkedIn messages</li>
              <li>Reply listing and acknowledgment</li>
              <li>Direct message sending</li>
            </UL>

            <SectionSubtitle>Background loops</SectionSubtitle>
            <UL>
              <li>Scheduler polls SQLite every 60s, sends due emails and fires connection requests</li>
              <li>IMAP poller checks Gmail every 5 minutes for reply approval commands</li>
            </UL>

            <P><Strong>Storage:</Strong> SQLite with Docker volume for persistence. Tables track scheduled sends, daily quotas, pipeline contacts, LinkedIn replies, and scheduled DMs.</P>
          </section>

          {/* ─── 11 · Problems Encountered and Solved ─── */}
          <section id="s11" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 11</SectionTag>
            <SectionTitle>Problems Encountered and Solved</SectionTitle>

            <Callout type="warning"><Strong>LLM detection scores consistently at 8/10.</Strong> Cold outreach emails are structurally formulaic (compliment → credential → ask) regardless of whether a human or LLM wrote them. The detection stage was calibrated against long-form writing, not short cold emails. Mitigated with best-of-N selection: three attempts give enough variance that the cleanest version surfaces. Not fully solved — the detector may need genre-specific calibration.</Callout>

            <Callout type="warning"><Strong>Cloud provider blocks SMTP egress.</Strong> Discovered after building the entire send pipeline. Port 587 (Gmail SMTP) was blocked at the network level. Moved scheduled sending to a VPS with no port restrictions. The CLI sends scheduling requests via HTTP; the background loop polls SQLite every 60 seconds and fires the actual send.</Callout>

            <Callout type="warning"><Strong>Enterprise mail servers defeat validation.</Strong> Large companies often return positive responses for every address (catch-all) or temporarily reject unknown senders. Built the LinkedIn-only path as a fallback so these high-value profiles aren't dead ends.</Callout>

            <Callout type="warning"><Strong>API hangs on dense profiles.</Strong> Some profiles with extensive work histories caused the aggregation API to stall for 60+ seconds. Added explicit 90-second timeouts so failures surface cleanly instead of blocking the entire enrichment batch.</Callout>

            <Callout type="warning"><Strong>Tone calibration across seniority levels.</Strong> Early drafts used peer-level language with VP/Director-level recipients ("swap notes", casual tone). The prompt now detects recipient persona (builder, enterprise leader, IC, researcher) and adjusts: early-career engineers reaching up to senior leaders should sound curious and humble, not like they're cosplaying as equals.</Callout>

            <Callout type="warning"><Strong>Bolding the wrong thing.</Strong> Initial emails bolded the sender's credentials. Reversed the rule: bold exactly one span, and it must be about the recipient's work — something they'll recognize and care about. The sender's signal is a plain-text one-liner.</Callout>

            <Callout type="warning"><Strong>SQLite concurrent access under load.</Strong> The background scheduler held a database connection while HTTP endpoints tried to write, causing lock errors. Fixed by adding timeouts to all connections so writers wait for the lock instead of failing immediately.</Callout>

            <Callout type="warning"><Strong>Prompt iteration from verbose to minimal.</Strong> Three rounds of prompt rewriting: (1) Mode A/B with technical depth vs. trajectory approaches — too formulaic. (2) Five-angle analysis with more scenarios — still too abstract and AI-sounding. (3) Final 3-sentence format with hard structural rules — state project, state why them, ask for 15 min. No filler, no flattery, no bridge paragraphs. This is what ships.</Callout>
          </section>

          {/* ─── 12 · Results ─── */}
          <section id="s12" className="py-14 border-b border-[#d0d0e0] dark:border-[#2a2a45]">
            <SectionTag>Section 12</SectionTag>
            <SectionTitle>Results</SectionTitle>

            <UL>
              <li>100+ new connections in 2 months of active use</li>
              <li>Pipeline processes ~25 profiles per run (discovery through drafting)</li>
              <li>Average 3 LLM calls per email (generation + 2 quality checks), up to 9 on retries</li>
              <li>Zero bounces on validated email addresses</li>
              <li>Time per batch: ~15 minutes for enrichment + generation, ~10 minutes for review</li>
              <li>Reply handling: webhook-to-notification latency under 30 seconds</li>
            </UL>
          </section>

          {/* ─── 13 · What's Next ─── */}
          <section id="s13" className="py-14">
            <SectionTag>Section 13</SectionTag>
            <SectionTitle>What's Next</SectionTitle>

            <UL>
              <li><Strong>Autonomous agent loop.</Strong> An LLM agent wrapping the CLI to run discover → enrich → draft → schedule automatically on a daily cron. City/state rotation across target markets.</li>
              <li><Strong>Non-interactive CLI mode.</Strong> Auto-approve and batch-approve flags so the agent can approve drafts programmatically.</li>
              <li><Strong>A/B testing on send times.</Strong> The activity-pattern heuristic is untested against random timing. No measurement infrastructure yet.</li>
              <li><Strong>Follow-up DMs for LinkedIn-only.</Strong> Automated follow-ups after connection acceptance.</li>
              <li><Strong>Polling fallback for webhooks.</Strong> If the webhook fails to deliver (server restart, network blip), messages could be lost. A periodic poll of recent conversations would catch missed replies.</li>
            </UL>
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

export default LinkedinAgentPost;
