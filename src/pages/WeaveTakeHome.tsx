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
      { label: 'PRs merged',        value: `${m.prs_merged} / ${m.prs_authored}` },
      { label: 'Primary subsystem', value: m.primary_subsystem || '—' },
      { label: 'Dir. focus',        value: `${Math.round(m.directory_concentration * 100)}%` },
    ],
    allMetrics: (m) => [
      { label: 'PRs authored',              value: m.prs_authored },
      { label: 'PRs merged',               value: m.prs_merged },
      { label: 'Merge rate',               value: `${Math.round(m.merge_rate * 100)}%` },
      { label: 'Primary subsystem',        value: m.primary_subsystem || '—' },
      { label: 'Dir. concentration',       value: `${Math.round(m.directory_concentration * 100)}%` },
      { label: 'Repeat files (3+ touches)', value: m.repeat_files_count },
      { label: 'Avg PR size (lines)',       value: Math.round(m.avg_pr_size).toLocaleString() },
    ],
  },
  reviewer: {
    title: 'Reviewers',
    desc: 'Engineers who unblock the team and maintain code quality',
    color: '#3ecf8e',
    label: 'Reviewer',
    keyMetrics: (m) => [
      { label: 'Reviews given',     value: m.reviews_given },
      { label: 'Changes requested', value: `${m.changes_requested_count} (${Math.round(m.changes_requested_ratio * 100)}%)` },
      { label: 'Unique authors',    value: m.unique_authors_reviewed },
    ],
    allMetrics: (m) => [
      { label: 'Total reviews given',     value: m.reviews_given },
      { label: 'PRs reviewed',            value: m.prs_reviewed },
      { label: 'Changes requested',       value: m.changes_requested_count },
      { label: 'Approved',                value: m.approved_count },
      { label: 'Changes req. ratio',      value: `${Math.round(m.changes_requested_ratio * 100)}%` },
      { label: 'Unique authors reviewed', value: m.unique_authors_reviewed },
      { label: 'Comment substance ratio', value: `${Math.round(m.avg_comment_substance_ratio * 100)}%` },
      { label: 'Avg review speed',        value: m.avg_review_speed_hours < 900 ? `${m.avg_review_speed_hours}h` : '—' },
      { label: 'Reviewed PR merge rate',  value: `${Math.round(m.reviewed_merge_rate * 100)}%` },
      { label: 'Times requested',         value: m.times_requested_as_reviewer },
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
      { label: 'Total PRs authored', value: m.prs_authored },
      { label: 'Infra PRs count',    value: m.infra_prs_count },
      { label: 'Infra PR ratio',     value: `${Math.round(m.infra_pr_ratio * 100)}%` },
      { label: 'Infra merge rate',   value: `${Math.round(m.infra_merge_rate * 100)}%` },
      { label: 'Infra subsystems',   value: (m.infra_subsystems as string[]).join(', ') || '—' },
      { label: 'CI/CD file changes', value: m.cicd_file_changes },
      { label: 'Dep. update PRs',    value: m.dep_update_prs_count },
    ],
  },
};

const BUCKETS = Object.entries(BUCKET_META).map(([key, v]) => ({
  key: key as BucketKey, label: v.title, color: v.color,
}));

const THOUGHT_DOCS: { key: ThoughtDocKey; label: string; desc: string }[] = [
  { key: 'categories', label: 'Engineering Impact Categories', desc: 'The 7-category framework I designed' },
  { key: 'todos',      label: 'Future TODOs',                  desc: "What I'd build next" },
  { key: 'datafetch',  label: 'Data Fetch',                    desc: 'Issues & decisions during collection' },
];

// ─── Shared inline style helpers ─────────────────────────────────────────────

const row = (extra?: React.CSSProperties): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', ...extra,
});
const col = (extra?: React.CSSProperties): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', ...extra,
});
const between = (extra?: React.CSSProperties): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...extra,
});

// ─── Thought process content ─────────────────────────────────────────────────

const CategoriesContent = () => (
  <div style={col({ gap: 12 })}>
    <p style={{ color: '#9090b0', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
      Before writing scoring logic, I mapped 7 distinct engineering impact archetypes. The dashboard
      implements 3 — the ones with the strongest GitHub signal.
    </p>
    {[
      { n: 1, title: 'Feature Owners (depth)',       color: '#4a9eff', body: 'Own a subsystem end-to-end. Large PRs, concentrated in specific directories, long commit history in same files.',                                     signal: 'PR size × complexity × ownership continuity' },
      { n: 2, title: 'Reviewers / Gatekeepers',      color: '#3ecf8e', body: 'Unblock the team. High review volume, fast turnaround, substantive comments (not just approvals).',                                                 signal: "reviews given × comment depth × others' PRs they touched that shipped" },
      { n: 3, title: 'Cross-cutting Contributors',   color: '#7c6aff', body: 'Work across many features simultaneously. Touch infra, frontend, backend in the same week.',                                                       signal: 'directory diversity × PR frequency × files changed across subsystems' },
      { n: 4, title: 'Bug Fixers / Reliability',     color: '#ff6a9a', body: 'Keep the product stable. Small targeted PRs, issue-linked commits, fast cycle time.',                                                             signal: 'issues closed × fix speed × recurrence rate' },
      { n: 5, title: 'Community Managers',           color: '#ffc96a', body: 'PostHog is open source — a unique bucket. Triage external PRs, respond to issues, review community contributions.',                               signal: 'external PR reviews + issue responses + community PR merges' },
      { n: 6, title: 'Force Multipliers / Mentors',  color: '#7c6aff', body: 'Their reviews make other engineers better. Impact flows through review quality.',                                                                 signal: "comment quality (length/substance), junior PRs they reviewed that shipped cleanly" },
      { n: 7, title: 'Infrastructure / Platform',    color: '#f5a623', body: 'Enable everyone else. CI/CD, tooling, build system. Low visibility but high leverage.',                                                          signal: 'files changed in .github/, Makefile, infra dirs × downstream PRs unblocked' },
    ].map(cat => (
      <div key={cat.n} style={{ borderLeft: `3px solid ${cat.color}`, backgroundColor: `${cat.color}15`, borderRadius: 8, padding: 16 }}>
        <div style={row({ gap: 8, marginBottom: 6 })}>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: cat.color }}>{cat.n}.</span>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#e8e8f0' }}>{cat.title}</span>
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.6, color: '#9090b0', marginBottom: 6 }}>{cat.body}</p>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#5a5a7a' }}>signal: {cat.signal}</div>
      </div>
    ))}
  </div>
);

const TodosContent = () => (
  <div style={col({ gap: 12 })}>
    <p style={{ fontSize: 14, lineHeight: 1.6, color: '#9090b0', marginBottom: 4 }}>Two high-priority improvements I'd tackle given more time.</p>
    <div style={{ borderLeft: '3px solid #7c6aff', backgroundColor: '#7c6aff15', borderRadius: 8, padding: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#e8e8f0', marginBottom: 8 }}>1. Keep data fresh via cron</div>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: '#9090b0' }}>
        Set up a daily/weekly cron job that re-runs <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#7c6aff' }}>fetch.py</span>, writes results to a small DB, and exposes an API endpoint. The frontend fetches from that instead of a static <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#7c6aff' }}>data.json</span> — so rankings always reflect the last N days automatically.
      </p>
    </div>
    <div style={{ borderLeft: '3px solid #6affe0', backgroundColor: '#6affe015', borderRadius: 8, padding: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#e8e8f0', marginBottom: 8 }}>2. Implement more engineering categories</div>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: '#9090b0' }}>
        The 7-category framework covers far more than the current 3. Adding cross-cutting contributors, bug fixers, and community managers would give a fuller picture — especially relevant for PostHog given its open-source model.
      </p>
    </div>
  </div>
);

const DataFetchContent = () => (
  <div style={col({ gap: 16 })}>
    <p style={{ fontSize: 14, lineHeight: 1.6, color: '#9090b0' }}>Four concrete issues hit during data collection — each with a decision and reasoning.</p>
    {[
      { n: 'Issue 1', title: 'Fetching all PRs before date-filtering',  color: '#4a9eff', problem: 'Initial paginate() downloaded the entire PR history before applying the 90-day filter — 6421 PRs from a repo with 37k+ total commits.', decision: 'Added a cutoff parameter to paginate() that stops at the API level as soon as an item older than the cutoff is encountered.', why: 'Early termination cuts both total API calls and runtime proportionally. For this repo, the difference is between minutes and hours.' },
      { n: 'Issue 2', title: '6419 PRs in 90 days = hours of runtime',  color: '#ff6a9a', problem: 'Even with early termination, ~6400 non-bot PRs in 90 days. At 0.05s sleep: 6419 × 3 × 0.05s ≈ 16 min in sleep alone, total ~5+ hours.', decision: 'Added MAX_PRS = 300 and reduced SLEEP from 0.05s → 0.02s. Cap applies when base is master and PR count exceeds 300, taking the most recent 300.', why: "300 PRs is sufficient to identify the top 5. 0.02s sleep keeps us under GitHub's 5000 req/hr limit. Trade-off: engineers active earlier in the window but not in the most recent 300 will be under-represented." },
      { n: 'Issue 3', title: 'Transient HTTP 500 from GitHub API',       color: '#ffc96a', problem: "During the first run, one PR's /files endpoint returned HTTP 500.", decision: 'No code change needed — existing retry logic (3 attempts with backoff) handled it automatically.', why: "500s from GitHub are transient. If a PR's detail fetch ultimately fails, that PR contributes no file/review data but is still counted — graceful degradation." },
      { n: 'Issue 4', title: 'PRs not filtered to main branch',          color: '#3ecf8e', problem: 'Initial API call fetched PRs targeting any base branch — feature branches, release branches, etc. This inflated PR counts with work that never lands in production.', decision: 'Added &base=master to the pulls API call. BASE_BRANCH exposed as a constant for easy adjustment.', why: 'Engineering impact should be measured by work that lands in the main codebase. Filtering to master ensures metrics reflect production-bound work only.' },
    ].map(issue => (
      <div key={issue.n} style={{ border: '1px solid #2a2a3a', borderRadius: 8, overflow: 'hidden' }}>
        <div style={row({ gap: 8, padding: '10px 16px', backgroundColor: `${issue.color}20`, color: issue.color, fontFamily: 'DM Mono, monospace', fontSize: 12 })}>
          <span style={{ opacity: 0.6 }}>{issue.n}</span>
          <span style={{ fontWeight: 600 }}>{issue.title}</span>
        </div>
        <div style={col({ gap: 12, padding: '12px 16px', backgroundColor: '#0f1117' })}>
          {[{ label: 'Problem', text: issue.problem }, { label: 'Decision', text: issue.decision }, { label: 'Why', text: issue.why }].map(r => (
            <div key={r.label}>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#5a5a7a', marginBottom: 4 }}>{r.label}</div>
              <p style={{ fontSize: 12, lineHeight: 1.6, color: '#9090b0' }}>{r.text}</p>
            </div>
          ))}
        </div>
      </div>
    ))}
    <div style={{ border: '1px solid #2a2a3a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 16px', fontFamily: 'DM Mono, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', backgroundColor: '#1a1a2a', color: '#5a5a7a' }}>Final Parameters</div>
      <div style={{ padding: 12, backgroundColor: '#0f1117' }}>
        {[
          ['WINDOW_DAYS',         '90',     'Assignment spec'],
          ['MAX_PRS',             '300',    'Runtime constraint — sufficient for top-5 ranking'],
          ['SLEEP_BETWEEN_CALLS', '0.02s',  'Safe under 5000 req/hr; keeps runtime ~10 min'],
          ['BASE_BRANCH',         'master', "Only PRs targeting PostHog's main branch"],
          ['MIN_PRS_THRESHOLD',   '3',      'Exclude engineers with too little signal'],
          ['Retries per call',    '3',      'Handle transient GitHub 500s/429s'],
        ].map(([p, v, r]) => (
          <div key={p} style={row({ gap: 12, padding: '6px 0', borderBottom: '1px solid #1a1a2a' })}>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#7c6aff', width: 180, flexShrink: 0 }}>{p}</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#e8e8f0', width: 56, flexShrink: 0 }}>{v}</span>
            <span style={{ fontSize: 11, lineHeight: 1.5, color: '#5a5a7a' }}>{r}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ─── Modal ────────────────────────────────────────────────────────────────────

const ThoughtProcessModal = ({ doc, onClose }: { doc: ThoughtDocKey; onClose: () => void }) => {
  const TITLES: Record<ThoughtDocKey, string> = {
    categories: 'Engineering Impact Categories',
    todos:      'Future TODOs',
    datafetch:  'Data Fetch — Issues & Decisions',
  };
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.75)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 672, display: 'flex', flexDirection: 'column', borderRadius: 16, boxShadow: '0 25px 50px rgba(0,0,0,0.5)', backgroundColor: '#0f1117', border: '1px solid #2a2a3a', maxHeight: '85vh' }}
      >
        <div style={between({ padding: '24px 24px 16px', borderBottom: '1px solid #2a2a3a', flexShrink: 0, alignItems: 'flex-start' })}>
          <div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#7c6aff', marginBottom: 8 }}>Thought Process</div>
            <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: '#e8e8f0', margin: 0 }}>{TITLES[doc]}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a5a7a', padding: 4, flexShrink: 0 }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: 24, flex: 1 }}>
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
  const meta  = BUCKET_META[bucket];
  const score = Math.round((eng.scores[bucket] ?? 0) * 10) / 10;
  const m     = eng.metrics;

  return (
    <div
      onClick={onToggle}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, borderRadius: 12, padding: 16, cursor: 'pointer', backgroundColor: '#1a1d27', border: `1px solid ${expanded ? meta.color : '#2e3350'}`, overflow: 'hidden' }}
    >
      {/* Top row */}
      <div style={row({ gap: 10, flexShrink: 0 })}>
        {eng.avatar_url
          ? <img src={eng.avatar_url} alt={eng.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #2e3350' }} />
          : <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#22263a', border: '2px solid #2e3350', fontWeight: 700, fontSize: 14, color: '#8b90a8' }}>{(eng.name || eng.username).charAt(0).toUpperCase()}</div>
        }
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#e8eaf0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eng.name}</div>
          <a href={`https://github.com/${eng.username}`} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: '#8b90a8', textDecoration: 'none' }}>@{eng.username}</a>
        </div>
        <div style={{ fontWeight: 900, fontSize: 18, color: '#2e3350', flexShrink: 0 }}>#{rank}</div>
      </div>

      {/* Badge */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: `${meta.color}20`, color: meta.color, width: 'fit-content' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: meta.color, flexShrink: 0 }} />
        {meta.label}
      </div>

      {/* Score bar */}
      <div style={row({ gap: 8 })}>
        <span style={{ fontSize: 11, color: '#8b90a8', width: 40, flexShrink: 0 }}>Score</span>
        <div style={{ flex: 1, height: 5, borderRadius: 99, backgroundColor: '#22263a', overflow: 'hidden' }}>
          <div style={{ width: `${score}%`, height: '100%', borderRadius: 99, backgroundColor: meta.color, transition: 'width 0.4s ease' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, width: 28, textAlign: 'right', color: '#e8eaf0', flexShrink: 0 }}>{score}</span>
      </div>

      {/* Reason */}
      <p style={{ fontSize: 11, lineHeight: 1.5, color: '#8b90a8', display: '-webkit-box', WebkitLineClamp: expanded ? 'unset' : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{eng.primary_reason}</p>

      {/* Key metrics */}
      <div style={col({ gap: 5 })}>
        {meta.keyMetrics(m).map(r => (
          <div key={r.label} style={between({ gap: 6 })}>
            <span style={{ fontSize: 11, color: '#8b90a8' }}>{r.label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e8eaf0', textAlign: 'right' }}>{String(r.value)}</span>
          </div>
        ))}
      </div>

      {/* Top PRs */}
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8b90a8', marginBottom: 4 }}>Top PRs</div>
        {(eng.top_prs || []).slice(0, 3).map(pr => (
          <a key={pr.number} href={pr.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} style={{ display: 'block', fontSize: 11, color: '#8b90a8', textDecoration: 'none', padding: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: meta.color, fontWeight: 600, marginRight: 4 }}>#{pr.number}</span>{pr.title}
          </a>
        ))}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={col({ gap: 6, paddingTop: 10, marginTop: 4, borderTop: '1px solid #2e3350' })}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8b90a8', marginBottom: 2 }}>All Metrics</div>
          {meta.allMetrics(m).map(r => (
            <div key={r.label} style={between({ gap: 8 })}>
              <span style={{ fontSize: 11, color: '#8b90a8' }}>{r.label}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#e8eaf0', textAlign: 'right' }}>{String(r.value)}</span>
            </div>
          ))}
          {eng.top_files?.length > 0 && (
            <>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8b90a8', marginTop: 8, marginBottom: 2 }}>Most-Touched Files</div>
              {eng.top_files.slice(0, 5).map(f => (
                <div key={f} style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#8b90a8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Expand hint */}
      <div style={{ textAlign: 'center', fontSize: 10, color: expanded ? meta.color : '#2e3350' }}>
        {expanded ? '▴ collapse' : '▾ expand'}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const WeaveTakeHome = () => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [activeBucket, setActiveBucket] = useState<BucketKey>('feature_owner');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeModal, setActiveModal]   = useState<ThoughtDocKey | null>(null);
  const [panelPos, setPanelPos]         = useState({ top: 0, left: 0 });

  const meta         = BUCKET_META[activeBucket];
  const topEngineers = (data.top_by_bucket[activeBucket] || []).map(u => data.engineers[u]).filter(Boolean);

  const date     = new Date(data.generated_at);
  const dateStr  = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#0f1117', color: '#e8eaf0', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: 14 }}>

      {/* ── Header ── */}
      <header style={between({ flexShrink: 0, padding: '16px 28px 12px', borderBottom: '1px solid #2e3350' })}>
        <div style={row({ gap: 12 })}>
          <Link to="/" style={row({ gap: 6, color: '#8b90a8', textDecoration: 'none', opacity: 1 })}>
            <ArrowLeft size={16} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>back</span>
          </Link>
          <div style={{ width: 1, height: 20, backgroundColor: '#2e3350', flexShrink: 0 }} />
          <div style={row({ gap: 12 })}>
            <div style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: '#f54e00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: '#fff', letterSpacing: '-0.5px', flexShrink: 0 }}>PH</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: '#e8eaf0' }}>PostHog Engineering Impact</div>
              <div style={{ fontSize: 12, color: '#8b90a8', marginTop: 2 }}>{subtitle}</div>
            </div>
          </div>
        </div>

        <div style={row({ gap: 12 })}>
          <div style={row({ gap: 6 })}>
            {['take-home', 'posthog/posthog', '90-day window'].map(tag => (
              <span key={tag} style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '2px 8px', borderRadius: 20, backgroundColor: '#22263a', color: '#5a5a7a' }}>{tag}</span>
            ))}
          </div>
          <button
            ref={btnRef}
            onClick={toggleDropdown}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'DM Mono, monospace', fontSize: 13, padding: '6px 12px', borderRadius: 8, border: '1px solid #2e3350', backgroundColor: '#22263a', color: '#e8eaf0', cursor: 'pointer' }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: meta.color, flexShrink: 0 }} />
            {meta.title}
            <ChevronDown size={12} style={{ color: '#8b90a8', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} />
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '18px 28px 0', minHeight: 0 }}>
        <div style={row({ gap: 10, flexShrink: 0, marginBottom: 14 })}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#8b90a8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{meta.title}</span>
          <span style={{ fontSize: 12, color: '#8b90a8' }}>{meta.desc}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
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
      <footer style={between({ flexShrink: 0, padding: '10px 28px', borderTop: '1px solid #2e3350' })}>
        <div style={{ fontSize: 11, color: '#8b90a8' }}>
          Scores are normalized within each bucket.{' '}
          <button onClick={() => setActiveModal('datafetch')} style={{ color: '#8b90a8', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11 }}>See data decisions</button>
        </div>
        <div style={{ fontSize: 11, color: '#2e3350' }}>{Object.keys(data.engineers).length} engineers · {data.repo}</div>
      </footer>

      {/* ── Dropdown panel ── */}
      {dropdownOpen && (
        <>
          <div onClick={() => setDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 9999, width: 256, backgroundColor: '#1a1d27', border: '1px solid #2e3350', borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '12px 12px 6px' }}>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#5a5a7a', marginBottom: 6, padding: '0 4px' }}>Dashboard</div>
              {BUCKETS.map(b => (
                <button
                  key={b.key}
                  onClick={() => switchBucket(b.key)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8, textAlign: 'left', border: 'none', cursor: 'pointer', fontSize: 12, color: '#e8eaf0', backgroundColor: activeBucket === b.key ? '#2e3350' : 'transparent' }}
                  onMouseEnter={e => { if (activeBucket !== b.key) (e.currentTarget as HTMLElement).style.backgroundColor = '#22263a'; }}
                  onMouseLeave={e => { if (activeBucket !== b.key) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: b.color, flexShrink: 0 }} />
                  {b.label}
                  {activeBucket === b.key && <span style={{ marginLeft: 'auto', fontFamily: 'DM Mono, monospace', fontSize: 9, color: '#5a5a7a' }}>active</span>}
                </button>
              ))}
            </div>
            <div style={{ margin: '6px 12px', borderTop: '1px solid #2e3350' }} />
            <div style={{ padding: '0 12px 12px' }}>
              <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#5a5a7a', marginBottom: 6, padding: '0 4px' }}>Thought Process</div>
              {THOUGHT_DOCS.map(doc => (
                <button
                  key={doc.key}
                  onClick={() => { setActiveModal(doc.key); setDropdownOpen(false); }}
                  style={{ width: '100%', display: 'flex', flexDirection: 'column', padding: 8, borderRadius: 8, textAlign: 'left', border: 'none', cursor: 'pointer', backgroundColor: 'transparent' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#22263a'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                >
                  <span style={{ fontSize: 12, color: '#e8eaf0' }}>{doc.label}</span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#5a5a7a', marginTop: 2 }}>{doc.desc}</span>
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
