import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, X } from 'lucide-react';
import rawData from '../data/weave-data.json';

// ─── Types ───────────────────────────────────────────────────────────────────

type BucketKey = 'feature_owner' | 'reviewer' | 'infra';
type ThoughtDocKey = 'categories' | 'todos' | 'datafetch';

interface Engineer {
  username: string;
  name: string;
  avatar_url: string;
  primary_bucket: string;
  scores: Record<BucketKey, number | null>;
  primary_reason: string;
  metrics: Record<string, any>;
  top_prs: { number: number; title: string; url: string }[];
  top_files: string[];
}

const data = rawData as {
  generated_at: string;
  window_days: number;
  repo: string;
  top_by_bucket: Record<BucketKey, string[]>;
  engineers: Record<string, Engineer>;
};

// ─── Bucket metadata ─────────────────────────────────────────────────────────

const BUCKET_META: Record<BucketKey, {
  title: string;
  desc: string;
  color: string;
  label: string;
  keyMetrics: (m: any) => { label: string; value: string | number }[];
  allMetrics: (m: any) => { label: string; value: string | number }[];
}> = {
  feature_owner: {
    title: 'Feature Owners',
    desc: 'Engineers who own subsystems end-to-end with depth and continuity',
    color: '#4a9eff',
    label: 'Feature Owner',
    keyMetrics: (m) => [
      { label: 'PRs merged',         value: `${m.prs_merged} / ${m.prs_authored}` },
      { label: 'Primary subsystem',  value: m.primary_subsystem || '—' },
      { label: 'Dir. focus',         value: `${Math.round(m.directory_concentration * 100)}%` },
    ],
    allMetrics: (m) => [
      { label: 'PRs authored',           value: m.prs_authored },
      { label: 'PRs merged',             value: m.prs_merged },
      { label: 'Merge rate',             value: `${Math.round(m.merge_rate * 100)}%` },
      { label: 'Primary subsystem',      value: m.primary_subsystem || '—' },
      { label: 'Dir. concentration',     value: `${Math.round(m.directory_concentration * 100)}%` },
      { label: 'Repeat files (3+ touches)', value: m.repeat_files_count },
      { label: 'Avg PR size (lines)',    value: Math.round(m.avg_pr_size).toLocaleString() },
    ],
  },
  reviewer: {
    title: 'Reviewers',
    desc: 'Engineers who unblock the team and maintain code quality',
    color: '#3ecf8e',
    label: 'Reviewer',
    keyMetrics: (m) => [
      { label: 'Reviews given',    value: m.reviews_given },
      { label: 'Changes requested', value: `${m.changes_requested_count} (${Math.round(m.changes_requested_ratio * 100)}%)` },
      { label: 'Unique authors',   value: m.unique_authors_reviewed },
    ],
    allMetrics: (m) => [
      { label: 'Total reviews given',      value: m.reviews_given },
      { label: 'PRs reviewed',             value: m.prs_reviewed },
      { label: 'Changes requested',        value: m.changes_requested_count },
      { label: 'Approved',                 value: m.approved_count },
      { label: 'Changes req. ratio',       value: `${Math.round(m.changes_requested_ratio * 100)}%` },
      { label: 'Unique authors reviewed',  value: m.unique_authors_reviewed },
      { label: 'Comment substance ratio',  value: `${Math.round(m.avg_comment_substance_ratio * 100)}%` },
      { label: 'Avg review speed',         value: m.avg_review_speed_hours < 900 ? `${m.avg_review_speed_hours}h` : '—' },
      { label: 'Reviewed PR merge rate',   value: `${Math.round(m.reviewed_merge_rate * 100)}%` },
      { label: 'Times requested',          value: m.times_requested_as_reviewer },
    ],
  },
  infra: {
    title: 'Infrastructure',
    desc: 'Engineers who enable the team through tooling, CI/CD, and platform work',
    color: '#f5a623',
    label: 'Infra',
    keyMetrics: (m) => [
      { label: 'Infra PRs',          value: `${m.infra_prs_count} (${Math.round(m.infra_pr_ratio * 100)}% of total)` },
      { label: 'Subsystems touched', value: m.infra_subsystem_count },
      { label: 'CI/CD file changes', value: m.cicd_file_changes },
    ],
    allMetrics: (m) => [
      { label: 'Total PRs authored',    value: m.prs_authored },
      { label: 'Infra PRs count',       value: m.infra_prs_count },
      { label: 'Infra PR ratio',        value: `${Math.round(m.infra_pr_ratio * 100)}%` },
      { label: 'Infra merge rate',      value: `${Math.round(m.infra_merge_rate * 100)}%` },
      { label: 'Infra subsystems',      value: (m.infra_subsystems as string[]).join(', ') || '—' },
      { label: 'CI/CD file changes',    value: m.cicd_file_changes },
      { label: 'Dep. update PRs',       value: m.dep_update_prs_count },
    ],
  },
};

const BUCKETS = Object.entries(BUCKET_META).map(([key, v]) => ({ key: key as BucketKey, label: v.title, color: v.color }));

const THOUGHT_DOCS: { key: ThoughtDocKey; label: string; desc: string }[] = [
  { key: 'categories', label: 'Engineering Impact Categories', desc: 'The 7-category framework I designed' },
  { key: 'todos',      label: 'Future TODOs',                  desc: "What I'd build next" },
  { key: 'datafetch',  label: 'Data Fetch',                    desc: 'Issues & decisions during collection' },
];

// ─── Thought process modal content ───────────────────────────────────────────

const CategoriesContent = () => (
  <div className="space-y-4">
    <p style={{ color: '#9090b0' }} className="text-sm leading-relaxed mb-6">
      Before writing scoring logic, I mapped 7 distinct engineering impact archetypes. The dashboard
      implements 3 — the ones with the strongest GitHub signal.
    </p>
    {[
      { n: 1, title: 'Feature Owners (depth)',            color: '#4a9eff', body: 'Own a subsystem end-to-end. Large PRs, concentrated in specific directories, long commit history in same files.', signal: 'PR size × complexity × ownership continuity' },
      { n: 2, title: 'Reviewers / Gatekeepers',          color: '#3ecf8e', body: 'Unblock the team. High review volume, fast turnaround, substantive comments (not just approvals).', signal: "reviews given × comment depth × others' PRs they touched that shipped" },
      { n: 3, title: 'Cross-cutting Contributors',       color: '#7c6aff', body: 'Work across many features simultaneously. Touch infra, frontend, backend in the same week.', signal: 'directory diversity × PR frequency × files changed across subsystems' },
      { n: 4, title: 'Bug Fixers / Reliability',         color: '#ff6a9a', body: 'Keep the product stable. Small targeted PRs, issue-linked commits, fast cycle time.', signal: 'issues closed × fix speed × recurrence rate' },
      { n: 5, title: 'Community Managers',               color: '#ffc96a', body: 'PostHog is open source — a unique bucket. Triage external PRs, respond to issues, review community contributions.', signal: 'external PR reviews + issue responses + community PR merges' },
      { n: 6, title: 'Force Multipliers / Mentors',      color: '#7c6aff', body: 'Their reviews make other engineers better. Impact flows through review quality.', signal: "comment quality (length/substance), junior PRs they reviewed that shipped cleanly" },
      { n: 7, title: 'Infrastructure / Platform',        color: '#f5a623', body: 'Enable everyone else. CI/CD, tooling, build system. Low visibility but high leverage.', signal: 'files changed in .github/, Makefile, infra dirs × downstream PRs unblocked' },
    ].map(cat => (
      <div key={cat.n} className="rounded-lg p-4" style={{ borderLeft: `3px solid ${cat.color}`, backgroundColor: `${cat.color}10` }}>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-['DM_Mono',monospace] text-xs" style={{ color: cat.color }}>{cat.n}.</span>
          <span className="font-semibold text-sm" style={{ color: '#e8e8f0' }}>{cat.title}</span>
        </div>
        <p className="text-xs leading-relaxed mb-2" style={{ color: '#9090b0' }}>{cat.body}</p>
        <div className="font-['DM_Mono',monospace] text-[10px]" style={{ color: '#5a5a7a' }}>signal: {cat.signal}</div>
      </div>
    ))}
  </div>
);

const TodosContent = () => (
  <div className="space-y-4">
    <p className="text-sm leading-relaxed mb-4" style={{ color: '#9090b0' }}>Two high-priority improvements I'd tackle given more time.</p>
    <div className="rounded-lg p-5" style={{ borderLeft: '3px solid #7c6aff', backgroundColor: '#7c6aff0f' }}>
      <div className="font-semibold text-sm mb-2" style={{ color: '#e8e8f0' }}>1. Keep data fresh via cron</div>
      <p className="text-sm leading-relaxed" style={{ color: '#9090b0' }}>
        Set up a daily/weekly cron job that re-runs <span className="font-['DM_Mono',monospace] text-xs" style={{ color: '#7c6aff' }}>fetch.py</span>, writes results to a small DB, and exposes an API endpoint. The frontend fetches from that instead of a static <span className="font-['DM_Mono',monospace] text-xs" style={{ color: '#7c6aff' }}>data.json</span> — so rankings always reflect the last N days automatically.
      </p>
    </div>
    <div className="rounded-lg p-5" style={{ borderLeft: '3px solid #6affe0', backgroundColor: '#6affe00f' }}>
      <div className="font-semibold text-sm mb-2" style={{ color: '#e8e8f0' }}>2. Implement more engineering categories</div>
      <p className="text-sm leading-relaxed" style={{ color: '#9090b0' }}>
        The 7-category framework covers far more than the current 3. Adding cross-cutting contributors, bug fixers, and community managers would give a fuller picture — especially relevant for PostHog given its open-source model.
      </p>
    </div>
  </div>
);

const DataFetchContent = () => (
  <div className="space-y-5">
    <p className="text-sm leading-relaxed" style={{ color: '#9090b0' }}>Four concrete issues hit during data collection — each with a decision and the reasoning behind it.</p>
    {[
      { n: 'Issue 1', title: 'Fetching all PRs before date-filtering', color: '#4a9eff', problem: 'Initial paginate() downloaded the entire PR history before applying the 90-day filter — 6421 PRs from a repo with 37k+ total commits.', decision: 'Added a cutoff parameter to paginate() that stops at the API level as soon as an item older than the cutoff is encountered.', why: 'Early termination cuts both total API calls and runtime proportionally. For this repo, the difference is between minutes and hours.' },
      { n: 'Issue 2', title: '6419 PRs in 90 days = hours of runtime', color: '#ff6a9a', problem: 'Even with early termination, ~6400 non-bot PRs in 90 days. At 0.05s sleep: 6419 × 3 × 0.05s ≈ 16 min in sleep alone, total ~5+ hours.', decision: 'Added MAX_PRS = 300 and reduced SLEEP from 0.05s → 0.02s. Cap applies when base is master and PR count exceeds 300, taking the most recent 300.', why: "300 PRs is sufficient to identify the top 5. 0.02s sleep keeps us under GitHub's 5000 req/hr limit. Trade-off: engineers active earlier in the window but not in the most recent 300 will be under-represented." },
      { n: 'Issue 3', title: 'Transient HTTP 500 from GitHub API', color: '#ffc96a', problem: "During the first run, one PR's /files endpoint returned HTTP 500.", decision: 'No code change needed — existing retry logic (3 attempts with backoff) handled it automatically.', why: "500s from GitHub are transient. If a PR's detail fetch ultimately fails, that PR contributes no file/review data but is still counted — graceful degradation." },
      { n: 'Issue 4', title: 'PRs not filtered to main branch', color: '#3ecf8e', problem: 'Initial API call fetched PRs targeting any base branch — feature branches, release branches, etc. This inflated PR counts with work that never lands in production.', decision: 'Added &base=master to the pulls API call. BASE_BRANCH exposed as a constant for easy adjustment.', why: 'Engineering impact should be measured by work that lands in the main codebase. Filtering to master ensures metrics reflect production-bound work only.' },
    ].map(issue => (
      <div key={issue.n} className="rounded-lg overflow-hidden" style={{ border: '1px solid #2a2a3a' }}>
        <div className="px-4 py-2.5 font-['DM_Mono',monospace] text-xs flex items-center gap-2" style={{ backgroundColor: `${issue.color}20`, color: issue.color }}>
          <span style={{ opacity: 0.6 }}>{issue.n}</span>
          <span className="font-semibold">{issue.title}</span>
        </div>
        <div className="px-4 py-3 space-y-3" style={{ backgroundColor: '#0f1117' }}>
          {[{ label: 'Problem', text: issue.problem }, { label: 'Decision', text: issue.decision }, { label: 'Why', text: issue.why }].map(row => (
            <div key={row.label}>
              <span className="font-['DM_Mono',monospace] text-[10px] uppercase tracking-wider" style={{ color: '#5a5a7a' }}>{row.label}</span>
              <p className="text-xs leading-relaxed mt-1" style={{ color: '#9090b0' }}>{row.text}</p>
            </div>
          ))}
        </div>
      </div>
    ))}
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #2a2a3a' }}>
      <div className="px-4 py-2 font-['DM_Mono',monospace] text-[10px] uppercase tracking-wider" style={{ backgroundColor: '#1a1a2a', color: '#5a5a7a' }}>Final Parameters</div>
      <div className="p-3" style={{ backgroundColor: '#0f1117' }}>
        {[['WINDOW_DAYS','90','Assignment spec'],['MAX_PRS','300','Runtime constraint — sufficient for top-5 ranking'],['SLEEP_BETWEEN_CALLS','0.02s','Safe under 5000 req/hr; keeps runtime ~10 min'],['BASE_BRANCH','master',"Only PRs targeting PostHog's main branch"],['MIN_PRS_THRESHOLD','3','Exclude engineers with too little signal'],['Retries per call','3','Handle transient GitHub 500s/429s']].map(([p,v,r]) => (
          <div key={p} className="flex gap-3 py-1.5" style={{ borderBottom: '1px solid #1a1a2a' }}>
            <span className="font-['DM_Mono',monospace] text-xs w-44 flex-shrink-0" style={{ color: '#7c6aff' }}>{p}</span>
            <span className="font-['DM_Mono',monospace] text-xs w-14 flex-shrink-0" style={{ color: '#e8e8f0' }}>{v}</span>
            <span className="text-[10px] leading-relaxed" style={{ color: '#5a5a7a' }}>{r}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ─── Modal ────────────────────────────────────────────────────────────────────

const ThoughtProcessModal = ({ doc, onClose }: { doc: ThoughtDocKey; onClose: () => void }) => {
  const TITLES: Record<ThoughtDocKey, string> = { categories: 'Engineering Impact Categories', todos: 'Future TODOs', datafetch: 'Data Fetch — Issues & Decisions' };
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="relative w-full max-w-2xl flex flex-col rounded-2xl shadow-2xl" style={{ backgroundColor: '#0f1117', border: '1px solid #2a2a3a', maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-6 pb-4 flex-shrink-0" style={{ borderBottom: '1px solid #2a2a3a' }}>
          <div>
            <div className="font-['DM_Mono',monospace] text-[0.6rem] tracking-[0.3em] uppercase mb-2" style={{ color: '#7c6aff' }}>Thought Process</div>
            <h2 className="font-['Playfair_Display',serif] text-2xl font-bold" style={{ color: '#e8e8f0' }}>{TITLES[doc]}</h2>
          </div>
          <button onClick={onClose} className="p-1 transition-colors" style={{ color: '#5a5a7a' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-6 flex-1">
          {doc === 'categories' && <CategoriesContent />}
          {doc === 'todos'      && <TodosContent />}
          {doc === 'datafetch'  && <DataFetchContent />}
        </div>
      </div>
    </div>
  );
};

// ─── Engineer Card ────────────────────────────────────────────────────────────

const EngineerCard = ({ eng, rank, bucket, expanded, onToggle }: {
  eng: Engineer; rank: number; bucket: BucketKey; expanded: boolean; onToggle: () => void;
}) => {
  const meta   = BUCKET_META[bucket];
  const score  = Math.round((eng.scores[bucket] ?? 0) * 10) / 10;
  const m      = eng.metrics;

  return (
    <div
      onClick={onToggle}
      className="flex flex-col gap-2.5 rounded-xl p-4 cursor-pointer transition-all"
      style={{
        backgroundColor: '#1a1d27',
        border: `1px solid ${expanded ? meta.color : '#2e3350'}`,
        overflow: 'hidden',
      }}
    >
      {/* Top row */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        {eng.avatar_url
          ? <img src={eng.avatar_url} alt={eng.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" style={{ border: '2px solid #2e3350' }} />
          : <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm" style={{ backgroundColor: '#22263a', border: '2px solid #2e3350', color: '#8b90a8' }}>{(eng.name || eng.username).charAt(0).toUpperCase()}</div>
        }
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[13px] truncate" style={{ color: '#e8eaf0' }}>{eng.name}</div>
          <a href={`https://github.com/${eng.username}`} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="text-[11px] hover:underline" style={{ color: '#8b90a8' }}>@{eng.username}</a>
        </div>
        <div className="font-black text-lg flex-shrink-0" style={{ color: '#2e3350' }}>#{rank}</div>
      </div>

      {/* Badge */}
      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider w-fit" style={{ backgroundColor: `${meta.color}20`, color: meta.color }}>
        <span className="w-1 h-1 rounded-full" style={{ backgroundColor: meta.color }} />
        {meta.label}
      </div>

      {/* Score bar */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] w-10 flex-shrink-0" style={{ color: '#8b90a8' }}>Score</span>
        <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: '#22263a' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, backgroundColor: meta.color }} />
        </div>
        <span className="text-xs font-bold w-8 text-right" style={{ color: '#e8eaf0' }}>{score}</span>
      </div>

      {/* Reason */}
      <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: '#8b90a8' }}>{eng.primary_reason}</p>

      {/* Key metrics */}
      <div className="space-y-1">
        {meta.keyMetrics(m).map(row => (
          <div key={row.label} className="flex justify-between items-center gap-2">
            <span className="text-[11px]" style={{ color: '#8b90a8' }}>{row.label}</span>
            <span className="text-[11px] font-semibold text-right" style={{ color: '#e8eaf0' }}>{String(row.value)}</span>
          </div>
        ))}
      </div>

      {/* Top PRs */}
      <div>
        <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#8b90a8' }}>Top PRs</div>
        {(eng.top_prs || []).slice(0, 3).map(pr => (
          <a key={pr.number} href={pr.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="block text-[11px] truncate py-0.5 hover:underline" style={{ color: '#8b90a8' }}>
            <span className="font-semibold" style={{ color: meta.color }}>#{pr.number}</span> {pr.title}
          </a>
        ))}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="pt-2.5 mt-1 space-y-1.5" style={{ borderTop: '1px solid #2e3350' }}>
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#8b90a8' }}>All Metrics</div>
          {meta.allMetrics(m).map(row => (
            <div key={row.label} className="flex justify-between gap-2">
              <span className="text-[11px]" style={{ color: '#8b90a8' }}>{row.label}</span>
              <span className="text-[11px] font-semibold text-right" style={{ color: '#e8eaf0' }}>{String(row.value)}</span>
            </div>
          ))}
          {eng.top_files?.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider mt-2 mb-1" style={{ color: '#8b90a8' }}>Most-Touched Files</div>
              {eng.top_files.slice(0, 5).map(f => (
                <div key={f} className="font-['DM_Mono',monospace] text-[10px] truncate" style={{ color: '#8b90a8' }}>{f}</div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Expand hint */}
      <div className="text-center text-[10px]" style={{ color: expanded ? meta.color : '#2e3350' }}>
        {expanded ? '▴ collapse' : '▾ expand'}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const WeaveTakeHome = () => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [activeBucket, setActiveBucket]   = useState<BucketKey>('feature_owner');
  const [expandedCard, setExpandedCard]   = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen]   = useState(false);
  const [activeModal, setActiveModal]     = useState<ThoughtDocKey | null>(null);
  const [panelPos, setPanelPos]           = useState({ top: 0, left: 0 });

  const meta        = BUCKET_META[activeBucket];
  const topEngineers = (data.top_by_bucket[activeBucket] || []).map(u => data.engineers[u]).filter(Boolean);

  const date    = new Date(data.generated_at);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const subtitle = `Last ${data.window_days} days · Generated ${dateStr} · Top 5 most impactful engineers`;

  const toggleDropdown = () => {
    if (!dropdownOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 6, left: rect.left });
    }
    setDropdownOpen(o => !o);
  };

  const switchBucket = (key: BucketKey) => {
    setActiveBucket(key);
    setExpandedCard(null);
    setDropdownOpen(false);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: '#0f1117', color: '#e8eaf0', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: 14 }}>

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-7 flex-shrink-0" style={{ padding: '16px 28px 12px', borderBottom: '1px solid #2e3350' }}>
        <div className="flex items-center gap-3">
          {/* Back */}
          <Link to="/" className="flex items-center gap-1 transition-opacity hover:opacity-70" style={{ color: '#8b90a8', textDecoration: 'none' }}>
            <ArrowLeft className="w-4 h-4" />
            <span className="font-['DM_Mono',monospace] text-xs">back</span>
          </Link>
          <div style={{ width: 1, height: 20, backgroundColor: '#2e3350' }} />
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded font-black text-xs text-white" style={{ width: 28, height: 28, backgroundColor: '#f54e00', borderRadius: 6, fontSize: 13, letterSpacing: '-0.5px' }}>PH</div>
            <div>
              <div className="font-bold" style={{ fontSize: 17 }}>PostHog Engineering Impact</div>
              <div style={{ fontSize: 12, color: '#8b90a8', marginTop: 1 }}>{subtitle}</div>
            </div>
          </div>
        </div>

        {/* Dropdown trigger */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex gap-1.5">
            {['take-home', 'posthog/posthog', '90-day window'].map(tag => (
              <span key={tag} className="font-['DM_Mono',monospace]" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, backgroundColor: '#22263a', color: '#5a5a7a' }}>{tag}</span>
            ))}
          </div>
          <button
            ref={btnRef}
            onClick={toggleDropdown}
            className="flex items-center gap-2 font-['DM_Mono',monospace] transition-colors"
            style={{ fontSize: 13, padding: '6px 12px', borderRadius: 8, border: '1px solid #2e3350', backgroundColor: '#22263a', color: '#e8eaf0', cursor: 'pointer' }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
            {meta.title}
            <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`} style={{ color: '#8b90a8' }} />
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col overflow-hidden" style={{ padding: '18px 28px 0' }}>
        {/* Bucket header */}
        <div className="flex items-center gap-2 flex-shrink-0" style={{ marginBottom: 14 }}>
          <span className="font-semibold uppercase" style={{ fontSize: 13, color: '#8b90a8', letterSpacing: '0.06em' }}>{meta.title}</span>
          <span style={{ fontSize: 12, color: '#8b90a8', marginLeft: 4 }}>{meta.desc}</span>
        </div>

        {/* Cards grid */}
        <div className="flex-1 overflow-hidden" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {topEngineers.map((eng, i) => (
            <EngineerCard
              key={eng.username}
              eng={eng}
              rank={i + 1}
              bucket={activeBucket}
              expanded={expandedCard === eng.username}
              onToggle={() => setExpandedCard(expandedCard === eng.username ? null : eng.username)}
            />
          ))}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="flex items-center justify-between flex-shrink-0" style={{ padding: '10px 28px', borderTop: '1px solid #2e3350' }}>
        <div style={{ fontSize: 11, color: '#8b90a8' }}>
          Scores are normalized within each bucket.{' '}
          <button onClick={() => setActiveModal('datafetch')} style={{ color: '#8b90a8', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11 }}>See data decisions</button>
        </div>
        <div style={{ fontSize: 11, color: '#2e3350' }}>{Object.keys(data.engineers).length} engineers · {data.repo}</div>
      </footer>

      {/* ── Dropdown panel — fixed, above everything ── */}
      {dropdownOpen && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setDropdownOpen(false)} />
          <div className="fixed rounded-xl overflow-hidden shadow-2xl" style={{ top: panelPos.top, left: panelPos.left, zIndex: 9999, width: 256, backgroundColor: '#1a1d27', border: '1px solid #2e3350' }}>
            <div style={{ padding: '12px 12px 6px' }}>
              <div className="font-['DM_Mono',monospace] px-1 mb-1.5" style={{ fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#5a5a7a' }}>Dashboard</div>
              {BUCKETS.map(b => (
                <button key={b.key} onClick={() => switchBucket(b.key)} className="w-full flex items-center gap-2.5 text-left transition-colors rounded-lg" style={{ padding: '8px', backgroundColor: activeBucket === b.key ? '#2e3350' : 'transparent', color: '#e8eaf0', border: 'none', cursor: 'pointer', fontSize: 12 }}
                  onMouseEnter={e => { if (activeBucket !== b.key) (e.currentTarget as HTMLElement).style.backgroundColor = '#22263a'; }}
                  onMouseLeave={e => { if (activeBucket !== b.key) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                  {b.label}
                  {activeBucket === b.key && <span className="ml-auto font-['DM_Mono',monospace]" style={{ fontSize: 9, color: '#5a5a7a' }}>active</span>}
                </button>
              ))}
            </div>
            <div style={{ margin: '6px 12px', borderTop: '1px solid #2e3350' }} />
            <div style={{ padding: '0 12px 12px' }}>
              <div className="font-['DM_Mono',monospace] px-1 mb-1.5" style={{ fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#5a5a7a' }}>Thought Process</div>
              {THOUGHT_DOCS.map(doc => (
                <button key={doc.key} onClick={() => { setActiveModal(doc.key); setDropdownOpen(false); }} className="w-full flex flex-col text-left transition-colors rounded-lg" style={{ padding: '8px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#22263a'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <span style={{ fontSize: 12, color: '#e8eaf0' }}>{doc.label}</span>
                  <span className="font-['DM_Mono',monospace] mt-0.5" style={{ fontSize: 10, color: '#5a5a7a' }}>{doc.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Modal ── */}
      {activeModal && <ThoughtProcessModal doc={activeModal} onClose={() => setActiveModal(null)} />}
    </div>
  );
};

export default WeaveTakeHome;
