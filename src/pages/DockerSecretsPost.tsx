import { useState, useEffect, useCallback } from 'react';
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

const Callout = ({ type, children }: { type: 'insight' | 'warning' | 'result'; children: React.ReactNode }) => {
  const styles = {
    insight: { bg: 'bg-[#7c6aff]/5 dark:bg-[#7c6aff]/[0.08]', border: 'border-[#7c6aff]', prefix: '◆ Insight — ', color: 'text-[#7c6aff]' },
    warning: { bg: 'bg-[#ff6a9a]/5 dark:bg-[#ff6a9a]/[0.08]', border: 'border-[#ff6a9a]', prefix: '⚠ Warning — ', color: 'text-[#ff6a9a]' },
    result: { bg: 'bg-[#6affe0]/5 dark:bg-[#6affe0]/[0.08]', border: 'border-[#6affe0]', prefix: '✓ Rule — ', color: 'text-[#6affe0]' },
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

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="font-['DM_Mono',monospace] text-[0.85em] px-1.5 py-0.5 rounded bg-[#7c6aff]/10 text-[#7c6aff] border border-[#7c6aff]/20">{children}</code>
);

// ─── Secret Leak Animation (Diagram 1) ───

const STEPS = [
  { phase: 'unsafe', caption: 'Agent runs grep -r to find credentials in the codebase…' },
  { phase: 'unsafe-reveal', caption: 'Plaintext secrets surface: DB_PASS=s3cr3t!, API_KEY=sk-abc123…' },
  { phase: 'unsafe-send', caption: 'Those values are sent in the prompt to LLM servers. Stored forever.' },
  { phase: 'safe', caption: 'With injection, secrets live only inside the container at runtime.' },
  { phase: 'safe-agent', caption: 'Agent references symbolic names: ssh ${VM_IP} — no real value in sight.' },
  { phase: 'safe-shield', caption: 'LLM only ever sees variable names. Values never leave your machine.' },
];

const SecretLeakAnimation = () => {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(true);

  const isExact = (s: string) => STEPS[step]?.phase === s;
  const isAtLeast = (phases: string[]) => phases.includes(STEPS[step]?.phase);

  const advance = useCallback(() => {
    setStep(s => (s + 1) % STEPS.length);
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(advance, step === 2 || step === 5 ? 2200 : 1600);
    return () => clearTimeout(t);
  }, [step, running, advance]);

  const caption = STEPS[step]?.caption ?? '';
  const unsafeActive = isAtLeast(['unsafe', 'unsafe-reveal', 'unsafe-send']);
  const safeActive = isAtLeast(['safe', 'safe-agent', 'safe-shield']);

  return (
    <div
      className="my-8 p-5 bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl select-none cursor-pointer"
      onClick={() => setRunning(r => !r)}
      title={running ? 'Click to pause' : 'Click to resume'}
    >
      <div className="font-['DM_Mono',monospace] text-[0.6rem] tracking-[0.2em] uppercase text-[#6a6a8a] dark:text-[#9090b0] mb-4 text-center">
        secret exposure — two scenarios
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        {/* ── UNSAFE panel ── */}
        <div className={`rounded-lg border p-3 sm:p-4 transition-all duration-500 ${unsafeActive ? 'border-[#ff6a9a] bg-[#ff6a9a]/[0.06]' : 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#16162a]'}`}>
          <div className={`font-['DM_Mono',monospace] text-[0.6rem] tracking-[0.18em] uppercase mb-3 transition-colors duration-300 ${unsafeActive ? 'text-[#ff6a9a]' : 'text-[#9a9ab0] dark:text-[#505070]'}`}>
            ✗ hardcoded / grepped
          </div>
          <div className={`font-['DM_Mono',monospace] text-[0.72rem] px-2 py-1.5 rounded border mb-2 transition-all duration-300 ${isExact('unsafe') || isAtLeast(['unsafe-reveal', 'unsafe-send']) ? 'border-[#ff6a9a]/60 bg-[#ff6a9a]/[0.1] text-[#ff6a9a]' : 'border-[#d0d0e0] dark:border-[#2a2a45] text-[#9a9ab0] dark:text-[#505070]'}`}>
            $ grep -r &quot;password&quot; .
          </div>
          <div className={`font-['DM_Mono',monospace] text-[0.72rem] px-2 py-1.5 rounded border mb-2 transition-all duration-300 ${isAtLeast(['unsafe-reveal', 'unsafe-send']) ? 'border-[#ff6a9a]/60 bg-[#ff6a9a]/[0.1] text-[#ff6a9a]' : 'border-[#d0d0e0] dark:border-[#2a2a45] text-[#9a9ab0] dark:text-[#505070]'}`}>
            $ cat .env
          </div>
          <div className={`font-['DM_Mono',monospace] text-[0.68rem] px-2 py-2 rounded border mb-2 transition-all duration-500 ${isAtLeast(['unsafe-reveal', 'unsafe-send']) ? 'border-[#ff6a9a] bg-[#ff6a9a]/[0.15] text-[#ff6a9a] shadow-[0_0_10px_rgba(255,106,154,0.3)]' : 'border-transparent text-transparent'}`}>
            DB_PASS=s3cr3t!<br />
            API_KEY=sk-abc123<br />
            VM_IP=192.168.1.1
          </div>
          <div className={`text-center transition-all duration-500 ${isAtLeast(['unsafe-send']) ? 'opacity-100' : 'opacity-0'}`}>
            <div className="font-['DM_Mono',monospace] text-[0.65rem] text-[#ff6a9a] animate-pulse">↑ sent to LLM servers</div>
            <div className="font-['DM_Mono',monospace] text-[0.58rem] text-[#ff6a9a]/70 mt-0.5">stored forever</div>
          </div>
        </div>

        {/* ── SAFE panel ── */}
        <div className={`rounded-lg border p-3 sm:p-4 transition-all duration-500 ${safeActive ? 'border-[#6affe0] bg-[#6affe0]/[0.05]' : 'border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#16162a]'}`}>
          <div className={`font-['DM_Mono',monospace] text-[0.6rem] tracking-[0.18em] uppercase mb-3 transition-colors duration-300 ${safeActive ? 'text-[#6affe0]' : 'text-[#9a9ab0] dark:text-[#505070]'}`}>
            ✓ injected
          </div>
          <div className={`font-['DM_Mono',monospace] text-[0.68rem] px-2 py-1.5 rounded border mb-2 transition-all duration-300 ${isAtLeast(['safe', 'safe-agent', 'safe-shield']) ? 'border-[#6affe0]/60 bg-[#6affe0]/[0.08] text-[#5a9a8a] dark:text-[#6affe0]' : 'border-[#d0d0e0] dark:border-[#2a2a45] text-[#9a9ab0] dark:text-[#505070]'}`}>
            docker run \<br />
            {'  '}--env-file secrets.env
          </div>
          <div className={`font-['DM_Mono',monospace] text-[0.68rem] px-2 py-2 rounded border mb-2 transition-all duration-500 ${isAtLeast(['safe-agent', 'safe-shield']) ? 'border-[#6affe0] bg-[#6affe0]/[0.12] text-[#5a9a8a] dark:text-[#6affe0] shadow-[0_0_10px_rgba(106,255,224,0.25)]' : 'border-transparent text-transparent'}`}>
            ssh $&#123;VM_IP&#125;<br />
            curl -H &quot;key: $&#123;API_KEY&#125;&quot;<br />
            psql $&#123;DB_URL&#125;
          </div>
          <div className={`text-center transition-all duration-500 ${isAtLeast(['safe-shield']) ? 'opacity-100' : 'opacity-0'}`}>
            <div className="font-['DM_Mono',monospace] text-[0.65rem] text-[#6affe0]">⟳ LLM sees names only</div>
            <div className="font-['DM_Mono',monospace] text-[0.58rem] text-[#6affe0]/70 mt-0.5">values stay local</div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <span className={`w-3 h-3 rounded-full border-2 transition-all duration-300 ${unsafeActive ? 'border-[#ff6a9a] bg-[#ff6a9a]/40' : 'border-[#d0d0e0] dark:border-[#2a2a45]'}`} />
        <span className="font-['DM_Mono',monospace] text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">unsafe path</span>
        <span className="flex-1 h-px bg-[#d0d0e0] dark:bg-[#2a2a45]" />
        <span className="font-['DM_Mono',monospace] text-[0.6rem] text-[#6a6a8a] dark:text-[#9090b0]">safe path</span>
        <span className={`w-3 h-3 rounded-full border-2 transition-all duration-300 ${safeActive ? 'border-[#6affe0] bg-[#6affe0]/40' : 'border-[#d0d0e0] dark:border-[#2a2a45]'}`} />
      </div>

      <div className="font-['DM_Mono',monospace] text-[0.78rem] text-[#6a6a8a] dark:text-[#9090b0] text-center min-h-[2.5rem] mt-4 px-2">{caption}</div>
      <div className="font-['DM_Mono',monospace] text-[0.55rem] text-[#9a9ab0] dark:text-[#505070] text-center mt-1">{running ? 'click to pause' : 'click to resume'}</div>
    </div>
  );
};

// ─── Docker Inject Diagram (Diagram 2 — static) ───

const DockerInjectDiagram = () => (
  <div className="my-8 p-5 bg-[#f0f0f8] dark:bg-[#10101a] border border-[#d0d0e0] dark:border-[#2a2a45] rounded-xl">
    <div className="font-['DM_Mono',monospace] text-[0.6rem] tracking-[0.2em] uppercase text-[#6a6a8a] dark:text-[#9090b0] mb-5 text-center">
      injection flow — secrets never in the repo
    </div>

    {/* top row: source → docker run */}
    <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
      <div className="px-3 py-2 rounded border border-[#ffc96a]/60 bg-[#ffc96a]/[0.08] font-['DM_Mono',monospace] text-[0.72rem] text-[#b8860b] dark:text-[#ffc96a] text-center">
        secrets.env<div className="text-[0.58rem] opacity-70 mt-0.5">outside repo</div>
      </div>
      <span className="text-[#6a6a8a] dark:text-[#9090b0] text-base">→</span>
      <div className="px-3 py-2 rounded border border-[#6affe0]/60 bg-[#6affe0]/[0.08] font-['DM_Mono',monospace] text-[0.72rem] text-[#5a9a8a] dark:text-[#6affe0] text-center">
        docker run<div className="text-[0.58rem] opacity-70 mt-0.5">--env-file</div>
      </div>
      <span className="text-[#6a6a8a] dark:text-[#9090b0] text-base">→</span>
      <div className="px-3 py-2 rounded border border-[#6affe0] bg-[#6affe0]/[0.12] font-['DM_Mono',monospace] text-[0.72rem] text-[#5a9a8a] dark:text-[#6affe0] text-center shadow-[0_0_8px_rgba(106,255,224,0.2)]">
        container<div className="text-[0.58rem] opacity-70 mt-0.5">process env vars</div>
      </div>
    </div>

    <div className="text-center text-[#6a6a8a] dark:text-[#9090b0] text-base mb-3">↓</div>

    {/* agent row */}
    <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
      <div className="px-3 py-2 rounded border border-[#7c6aff]/60 bg-[#7c6aff]/[0.08] font-['DM_Mono',monospace] text-[0.68rem] text-[#7c6aff] text-center">
        $&#123;API_KEY&#125;
      </div>
      <div className="px-3 py-2 rounded border border-[#7c6aff]/60 bg-[#7c6aff]/[0.08] font-['DM_Mono',monospace] text-[0.68rem] text-[#7c6aff] text-center">
        $&#123;DB_URL&#125;
      </div>
      <div className="px-3 py-2 rounded border border-[#7c6aff]/60 bg-[#7c6aff]/[0.08] font-['DM_Mono',monospace] text-[0.68rem] text-[#7c6aff] text-center">
        $&#123;VM_IP&#125;
      </div>
    </div>

    <div className="text-center text-[#6a6a8a] dark:text-[#9090b0] text-base mb-3">↓</div>

    {/* agent sees */}
    <div className="flex items-center justify-center gap-3 flex-wrap">
      <div className="px-4 py-2 rounded border border-[#6affe0] bg-[#6affe0]/[0.12] font-['DM_Mono',monospace] text-[0.72rem] text-[#5a9a8a] dark:text-[#6affe0] text-center shadow-[0_0_6px_rgba(106,255,224,0.2)]">
        agent ✓<div className="text-[0.58rem] opacity-70 mt-0.5">sees names only</div>
      </div>
      <span className="text-[#6a6a8a] dark:text-[#9090b0] text-base">→</span>
      <div className="px-4 py-2 rounded border border-[#d0d0e0] dark:border-[#2a2a45] bg-[#f8f8fc] dark:bg-[#16162a] font-['DM_Mono',monospace] text-[0.72rem] text-[#6a6a8a] dark:text-[#9090b0] text-center">
        LLM prompt<div className="text-[0.58rem] opacity-70 mt-0.5">no real values</div>
      </div>
      <span className="text-[#6a6a8a] dark:text-[#9090b0] text-base">→</span>
      <div className="px-4 py-2 rounded border border-[#6affe0]/40 bg-[#6affe0]/[0.05] font-['DM_Mono',monospace] text-[0.72rem] text-[#5a9a8a] dark:text-[#6affe0]/70 text-center">
        Anthropic / OpenAI<div className="text-[0.58rem] opacity-70 mt-0.5">harmless log</div>
      </div>
    </div>

    <div className="mt-4 text-center font-['DM_Mono',monospace] text-[0.65rem] text-[#6a6a8a] dark:text-[#9090b0]">
      bind mount keeps host files in sync — edits persist, nothing is copied
    </div>
  </div>
);

// ─── Table of Contents ───

const TOC_ITEMS = [
  { id: 's1', label: '01 · The Problem' },
  { id: 's2', label: '02 · The Fix' },
  { id: 's3', label: '03 · Caveats' },
];

// ─── Main Page Component ───

const DockerSecretsPost = () => {
  const { pageId, activeUsers, analytics } = usePageAnalytics('Your Agentic Coding Tool is Reading Your Secrets');

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
            Agentic AI Engineering
          </div>
          <h1 className="font-['Playfair_Display',serif] text-[clamp(2.4rem,7vw,4.5rem)] font-black leading-none tracking-tight text-[#001F3F] dark:text-white">
            Your Agentic Coding Tool<br />is <Em>Reading</Em> Your Secrets
          </h1>
          <p className="text-lg text-[#001F3F]/70 dark:text-white/70 max-w-2xl leading-relaxed">
            Why your coding agent should never see your secrets — and how Docker makes that possible.
          </p>
          <p className="text-sm text-[#001F3F]/60 dark:text-white/60">Author: Nikhil Kulkarni</p>
          <div className="flex flex-wrap items-center gap-4 text-[#001F3F]/60 dark:text-white/60">
            <div className="flex items-center space-x-2"><Calendar className="w-4 h-4" /><span>May 20, 2026</span></div>
            <div className="flex items-center space-x-2"><Clock className="w-4 h-4" /><span>3 min read</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Docker', 'Security', 'LLM Agents', 'Vibe Coding', 'DevOps'].map(tag => (
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

          {/* ─── Opening ─── */}
          <section className="py-12">
            <Lead>Every session with an agentic coding tool — Claude Code, Cursor, Copilot, all of them — is systematically insecure in a way most developers haven't thought through.</Lead>
            <P>When these tools explore your codebase, every file they read gets sent to the provider's servers as context. That includes your <Code>.env</Code> file, hardcoded VM IPs, internal URLs, API keys, and passwords.</P>
          </section>

          {/* ─── 01 · The Problem ─── */}
          <section id="s1" className="py-14">
            <SectionTag>Section 01</SectionTag>
            <SectionTitle>The Problem</SectionTitle>

            <P>They do this silently inside large toolcalls using standard shell commands like <Code>cat</Code>, <Code>grep -r</Code>, <Code>find</Code>, and <Code>printenv</Code> — completely normal parts of how coding agents navigate a project. Some of this data can be rotated if it leaks: a new API key takes thirty seconds. But some of it can't — your server IP, your personal information, your internal infrastructure. These live in your codebase because your application needs them. There's no reason they need to be stored on a third-party AI provider's servers indefinitely.</P>

            <SecretLeakAnimation />

          </section>

          {/* ─── 02 · The Fix ─── */}
          <section id="s2" className="py-14">
            <SectionTag>Section 02</SectionTag>
            <SectionTitle>The Fix</SectionTitle>

            <P>The solution is simpler than it sounds, and you don't need anything beyond Docker Desktop or OrbStack. Run your coding agent inside a Docker container and inject all sensitive values as environment variables at container launch via <Code>--env-file</Code> — a file that lives entirely outside your codebase. The codebase the agent works on is completely clean: no real secrets, no hardcoded values, nothing to find and transmit. The agent still has full access to do everything it needs — SSH into a server, authenticate with an API, connect to a database — because the values exist as process-level environment variables, not as files on disk.</P>

            <MathBlock label="docker run — --env-file" variant="green">{`# secrets.env lives outside the repo, never committed
docker run \\
  --env-file /path/outside/repo/secrets.env \\
  --mount type=bind,source=\$(pwd),target=/workspace \\
  my-agent-image

# Agent references names, never values:
#   ssh \${VM_IP}                        ← not  ssh 192.168.1.1
#   curl -H "Authorization: \${API_KEY}" ← not  curl -H "Authorization: sk-abc123"
#   psql \${DB_URL}                      ← not  psql postgresql://user:pass@host/db`}</MathBlock>

            <DockerInjectDiagram />

            <P>Critically, the container uses a bind mount, meaning the agent edits the exact same files on your host machine in real time: your <Code>PLAN.md</Code> gets updated, your code changes persist, your <Code>CLAUDE.md</Code> and memory files are all live and valid across sessions. Nothing is lost, nothing is copied — the container and your local machine share the same filesystem.</P>

            <P>Corporations already do a higher-level version of this: secrets are injected at runtime from vaults like AWS Secrets Manager or HashiCorp Vault, scoped per service, never stored as files anywhere. For vibecoders, the Docker <Code>--env-file</Code> approach is the right level of this same thoughtfulness.</P>
          </section>

          {/* ─── 03 · Caveats ─── */}
          <section id="s3" className="py-14">
            <SectionTag>Section 03</SectionTag>
            <SectionTitle>Caveats</SectionTitle>

            <P>This setup is not a silver bullet, and knowing where it breaks is as important as knowing how it works. The biggest surface-level gap: direct commands like <Code>printenv</Code>, <Code>env</Code>, and <Code>set</Code> dump everything injected into the process. Block these explicitly in <Code>.claude/settings.json</Code> using Claude Code's native permissions system:</P>

            <MathBlock label=".claude/settings.json" variant="yellow">{`{
  "permissions": [
    { "type": "deny", "tool": "Bash(printenv*)" },
    { "type": "deny", "tool": "Bash(env*)" },
    { "type": "deny", "tool": "Bash(set*)" }
  ]
}`}</MathBlock>

            <P>You can reinforce this with a rule in <Code>CLAUDE.md</Code> instructing the agent never to print environment variable values — but the <Code>settings.json</Code> block is the enforceable one. The deeper gap is harder to close: if the agent writes or runs a script that logs its own environment to stdout — a Python script with <Code>print(os.environ.items())</Code>, a Node script with <Code>console.log(process.env)</Code> — that output comes back as a tool result, lands in the model's context, and reaches Anthropic's servers anyway. The Docker boundary doesn't help here.</P>

            <Callout type="warning"><Strong>The deny rules reduce the risk for direct shell commands, but can't intercept subprocess stdout.</Strong> This approach meaningfully shrinks the attack surface; it doesn't eliminate it entirely.</Callout>

            <P>For a tighter boundary, Claude Code's native sensitive config and PreToolUse hooks (see: <Em>nopeek</Em>) can scrub matched patterns before they ever reach the model — worth researching if you need the next level. The second caveat is simpler: don't run your agent in auto-accept mode as a habit. Confirmation prompts exist for a reason. Treat them as a feature.</P>

            <Lead>The extra hour of setup is the difference between your infrastructure living on someone else's servers forever and it never being there at all.</Lead>
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

export default DockerSecretsPost;
