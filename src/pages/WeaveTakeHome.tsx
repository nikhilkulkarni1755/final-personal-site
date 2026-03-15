import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, X } from 'lucide-react';

type BucketKey = 'feature_owner' | 'reviewer' | 'infra';
type ThoughtDocKey = 'categories' | 'todos' | 'datafetch';

const BUCKETS: { key: BucketKey; label: string; color: string }[] = [
  { key: 'feature_owner', label: 'Feature Owners', color: '#4a9eff' },
  { key: 'reviewer',      label: 'Reviewers',       color: '#3ecf8e' },
  { key: 'infra',         label: 'Infrastructure',  color: '#f5a623' },
];

const THOUGHT_DOCS: { key: ThoughtDocKey; label: string; desc: string }[] = [
  { key: 'categories', label: 'Engineering Impact Categories', desc: 'The 7-category framework I designed' },
  { key: 'todos',      label: 'Future TODOs',                  desc: "What I'd build next" },
  { key: 'datafetch',  label: 'Data Fetch',                    desc: 'Issues & decisions during collection' },
];

// ─── Modal content components ───

const CategoriesContent = () => (
  <div className="space-y-4">
    <p className="text-[#9090b0] text-sm leading-relaxed mb-6">
      Before writing scoring logic, I mapped 7 distinct engineering impact archetypes. The dashboard
      implements 3 — the ones with the strongest GitHub signal.
    </p>
    {[
      {
        n: 1, title: 'Feature Owners (depth)', color: '#4a9eff',
        body: 'Own a subsystem end-to-end. Large PRs, concentrated in specific directories, long commit history in same files.',
        signal: 'PR size × complexity × ownership continuity',
      },
      {
        n: 2, title: 'Reviewers / Gatekeepers', color: '#3ecf8e',
        body: 'Unblock the team. High review volume, fast turnaround, substantive comments (not just approvals).',
        signal: "reviews given × comment depth × others' PRs they touched that shipped",
      },
      {
        n: 3, title: 'Cross-cutting Contributors (breadth)', color: '#7c6aff',
        body: 'Work across many features simultaneously. Touch infra, frontend, backend in the same week.',
        signal: 'directory diversity × PR frequency × files changed across subsystems',
      },
      {
        n: 4, title: 'Bug Fixers / Reliability', color: '#ff6a9a',
        body: 'Keep the product stable. Small targeted PRs, issue-linked commits, fast cycle time.',
        signal: 'issues closed × fix speed × recurrence rate',
      },
      {
        n: 5, title: 'Community Managers', color: '#ffc96a',
        body: 'PostHog is open source — a unique bucket. Triage external PRs, respond to issues, review community contributions.',
        signal: 'external PR reviews + issue responses + community PR merges',
      },
      {
        n: 6, title: 'Force Multipliers / Mentors', color: '#7c6aff',
        body: 'Their reviews make other engineers better. Impact flows through review quality and how often their comments get addressed.',
        signal: "comment quality (length/substance), junior PRs they reviewed that shipped cleanly",
      },
      {
        n: 7, title: 'Infrastructure / Platform', color: '#f5a623',
        body: 'Enable everyone else. CI/CD, tooling, build system. Low visibility but high leverage.',
        signal: 'files changed in .github/, Makefile, infra dirs × downstream PRs unblocked',
      },
    ].map(cat => (
      <div key={cat.n} className="rounded-lg p-4 border-l-[3px]" style={{ borderColor: cat.color, backgroundColor: `${cat.color}10` }}>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-['DM_Mono',monospace] text-xs" style={{ color: cat.color }}>{cat.n}.</span>
          <span className="font-semibold text-[#e8e8f0] text-sm">{cat.title}</span>
        </div>
        <p className="text-[#9090b0] text-xs leading-relaxed mb-2">{cat.body}</p>
        <div className="font-['DM_Mono',monospace] text-[10px] text-[#5a5a7a]">signal: {cat.signal}</div>
      </div>
    ))}
  </div>
);

const TodosContent = () => (
  <div className="space-y-4">
    <p className="text-[#9090b0] text-sm leading-relaxed mb-4">
      Two high-priority improvements I'd tackle given more time.
    </p>
    <div className="rounded-lg p-5 border-l-[3px] border-[#7c6aff] bg-[#7c6aff]/[0.06]">
      <div className="font-semibold text-[#e8e8f0] text-sm mb-2">1. Keep data fresh via cron</div>
      <p className="text-[#9090b0] text-sm leading-relaxed">
        Set up a daily/weekly cron job or server that re-runs{' '}
        <span className="font-['DM_Mono',monospace] text-xs text-[#7c6aff]">fetch.py</span>, writes
        results to a small DB (Postgres/SQLite), and exposes an API endpoint. The frontend fetches from
        that instead of a static{' '}
        <span className="font-['DM_Mono',monospace] text-xs text-[#7c6aff]">data.json</span> — so
        rankings always reflect the last N days automatically.
      </p>
    </div>
    <div className="rounded-lg p-5 border-l-[3px] border-[#6affe0] bg-[#6affe0]/[0.06]">
      <div className="font-semibold text-[#e8e8f0] text-sm mb-2">2. Implement more engineering categories</div>
      <p className="text-[#9090b0] text-sm leading-relaxed">
        The 7-category framework covers far more than the current 3. Adding cross-cutting contributors
        (breadth), bug fixers (reliability), and community managers (open-source specific) would give a
        fuller picture — especially relevant for PostHog given its open-source model.
      </p>
    </div>
  </div>
);

const DataFetchContent = () => (
  <div className="space-y-5">
    <p className="text-[#9090b0] text-sm leading-relaxed">
      Four concrete issues hit during data collection — each with a decision and the reasoning behind it.
    </p>
    {[
      {
        n: 'Issue 1', title: 'Fetching all PRs before date-filtering', color: '#4a9eff',
        problem: 'Initial paginate() downloaded the entire PR history before applying the 90-day filter — 6421 PRs from a repo with 37k+ total commits.',
        decision: 'Added a cutoff parameter to paginate() that stops at the API level as soon as an item older than the cutoff is encountered.',
        why: 'Early termination cuts both total API calls and runtime proportionally. For this repo, the difference is between minutes and hours.',
      },
      {
        n: 'Issue 2', title: '6419 PRs in 90 days = hours of runtime', color: '#ff6a9a',
        problem: 'Even with early termination, ~6400 non-bot PRs in 90 days (~71/day). Each PR requires 3 additional API calls plus sleep. At 0.05s sleep: 6419 × 3 × 0.05s ≈ 16 min in sleep alone, total ~5+ hours.',
        decision: 'Added MAX_PRS = 300 and reduced SLEEP from 0.05s → 0.02s. Cap applies conditionally: if base branch is master and PR count exceeds 300, take the most recent 300 (newest-first from the API).',
        why: "300 PRs is sufficient to identify the top 5. The most active contributors appear repeatedly in recent PRs. 0.02s sleep keeps us well under GitHub's 5000 req/hr limit (300 × 3 = 900 calls). Trade-off acknowledged: engineers active earlier in the window but not in the most recent 300 will be under-represented.",
      },
      {
        n: 'Issue 3', title: 'Transient HTTP 500 from GitHub API', color: '#ffc96a',
        problem: "During the first run, one PR's /files endpoint returned HTTP 500.",
        decision: 'No code change needed — existing retry logic (3 attempts with backoff) handled it automatically.',
        why: "500s from GitHub are transient and uncommon. If a PR's detail fetch ultimately fails after all retries, that PR contributes no file/review data but the PR itself is still counted — graceful degradation.",
      },
      {
        n: 'Issue 4', title: 'PRs not filtered to main branch', color: '#3ecf8e',
        problem: 'Initial API call fetched PRs targeting any base branch — feature branches, release branches, etc. This inflated PR counts with work that never lands in production.',
        decision: 'Added &base=master to the pulls API call. BASE_BRANCH exposed as a constant for easy adjustment.',
        why: 'Engineering impact should be measured by work that lands in the main codebase. Filtering to master ensures merge rate, file ownership, and review patterns reflect production-bound work only.',
      },
    ].map(issue => (
      <div key={issue.n} className="rounded-lg overflow-hidden border border-[#2a2a3a]">
        <div
          className="px-4 py-2.5 font-['DM_Mono',monospace] text-xs flex items-center gap-2"
          style={{ backgroundColor: `${issue.color}15`, color: issue.color }}
        >
          <span className="opacity-60">{issue.n}</span>
          <span className="font-semibold">{issue.title}</span>
        </div>
        <div className="px-4 py-3 space-y-3 bg-[#0f1117]">
          {[
            { label: 'Problem', text: issue.problem },
            { label: 'Decision', text: issue.decision },
            { label: 'Why', text: issue.why },
          ].map(row => (
            <div key={row.label}>
              <span className="font-['DM_Mono',monospace] text-[10px] text-[#5a5a7a] uppercase tracking-wider">{row.label}</span>
              <p className="text-[#9090b0] text-xs leading-relaxed mt-1">{row.text}</p>
            </div>
          ))}
        </div>
      </div>
    ))}

    <div className="rounded-lg overflow-hidden border border-[#2a2a3a]">
      <div className="px-4 py-2 font-['DM_Mono',monospace] text-[10px] text-[#5a5a7a] uppercase tracking-wider bg-[#1a1a2a]">Final Parameters</div>
      <div className="p-3 bg-[#0f1117]">
        {[
          ['WINDOW_DAYS',          '90',      'Assignment spec'],
          ['MAX_PRS',              '300',     'Runtime constraint — sufficient for top-5 ranking'],
          ['SLEEP_BETWEEN_CALLS',  '0.02s',   'Safe under 5000 req/hr; keeps runtime ~10 min'],
          ['BASE_BRANCH',          'master',  "Only PRs targeting PostHog's main branch"],
          ['MIN_PRS_THRESHOLD',    '3',       'Exclude engineers with too little signal'],
          ['Retries per call',     '3',       'Handle transient GitHub 500s/429s'],
        ].map(([param, val, reason]) => (
          <div key={param} className="flex gap-3 py-1.5 border-b border-[#1a1a2a] last:border-0">
            <span className="font-['DM_Mono',monospace] text-xs text-[#7c6aff] w-44 flex-shrink-0">{param}</span>
            <span className="font-['DM_Mono',monospace] text-xs text-[#e8e8f0] w-14 flex-shrink-0">{val}</span>
            <span className="text-[10px] text-[#5a5a7a] leading-relaxed">{reason}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ─── Modal shell ───

const ThoughtProcessModal = ({ doc, onClose }: { doc: ThoughtDocKey; onClose: () => void }) => {
  const TITLES: Record<ThoughtDocKey, string> = {
    categories: 'Engineering Impact Categories',
    todos:      'Future TODOs',
    datafetch:  'Data Fetch — Issues & Decisions',
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/75" />
      <div
        className="relative bg-[#0f1117] border border-[#2a2a3a] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 pb-4 border-b border-[#2a2a3a] flex-shrink-0">
          <div>
            <div className="font-['DM_Mono',monospace] text-[0.6rem] tracking-[0.3em] uppercase text-[#7c6aff] mb-2">
              Thought Process
            </div>
            <h2 className="font-['Playfair_Display',serif] text-2xl font-bold text-[#e8e8f0]">
              {TITLES[doc]}
            </h2>
          </div>
          <button onClick={onClose} className="text-[#5a5a7a] hover:text-[#e8e8f0] transition-colors p-1 -mr-1 -mt-1">
            <X className="w-5 h-5" />
          </button>
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

// ─── Main Component ───

const WeaveTakeHome = () => {
  const iframeRef    = useRef<HTMLIFrameElement>(null);
  const dropdownRef  = useRef<HTMLDivElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeModal, setActiveModal]   = useState<ThoughtDocKey | null>(null);
  const [activeBucket, setActiveBucket] = useState<BucketKey>('feature_owner');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const switchBucket = (key: BucketKey) => {
    setActiveBucket(key);
    setDropdownOpen(false);
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow) {
      try {
        const select = iframe.contentWindow.document.getElementById('bucket-select') as HTMLSelectElement;
        if (select) {
          select.value = key;
          select.dispatchEvent(new Event('change'));
        }
      } catch {
        // cross-origin safety — ignore
      }
    }
  };

  const openModal = (doc: ThoughtDocKey) => {
    setActiveModal(doc);
    setDropdownOpen(false);
  };

  const activeMeta = BUCKETS.find(b => b.key === activeBucket)!;

  return (
    <div className="h-screen flex flex-col bg-[#0f1117] overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-[#2a2a3a] flex-shrink-0">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-[#9090b0] hover:text-[#e8e8f0] transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="font-['DM_Mono',monospace] text-xs">back</span>
        </Link>

        <div className="w-px h-5 bg-[#2a2a3a]" />

        <div className="font-['DM_Mono',monospace] text-[0.6rem] tracking-[0.25em] uppercase text-[#7c6aff] px-2.5 py-1 border border-[#7c6aff]/30 rounded-full bg-[#7c6aff]/[0.08] flex-shrink-0">
          Take-Home
        </div>

        <h1 className="font-['Playfair_Display',serif] text-lg font-bold text-[#e8e8f0]">
          Weave <em className="italic text-[#7c6aff]">Engineering</em> Impact
        </h1>

        <span className="font-['DM_Mono',monospace] text-[#5a5a7a] text-xs hidden sm:block">
          posthog/posthog · 90-day window · 300 PR cap
        </span>

        <div className="flex-1" />

        <div className="hidden md:flex gap-1.5">
          {['feature-owners', 'reviewers', 'infrastructure'].map(tag => (
            <span
              key={tag}
              className="px-2 py-0.5 text-[10px] rounded-full bg-[#2a2a3a] text-[#5a5a7a] font-['DM_Mono',monospace]"
            >
              {tag}
            </span>
          ))}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 relative overflow-hidden">

        {/* Dropdown */}
        <div ref={dropdownRef} className="absolute top-3 left-3 z-[60]">
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#2a2a3a] bg-[#1a1d27] text-[#e8e8f0] text-xs font-['DM_Mono',monospace] hover:border-[#7c6aff]/50 transition-colors shadow-lg"
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: activeMeta.color }} />
            <span>{activeMeta.label}</span>
            <ChevronDown className={`w-3 h-3 text-[#5a5a7a] transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-64 bg-[#1a1d27] border border-[#2a2a3a] rounded-xl shadow-2xl overflow-hidden">

              {/* Dashboard section */}
              <div className="px-3 pt-3 pb-1.5">
                <div className="font-['DM_Mono',monospace] text-[9px] tracking-[0.25em] uppercase text-[#5a5a7a] mb-1.5 px-1">
                  Dashboard
                </div>
                {BUCKETS.map(b => (
                  <button
                    key={b.key}
                    onClick={() => switchBucket(b.key)}
                    className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${activeBucket === b.key ? 'bg-[#2a2a3a]' : 'hover:bg-[#22263a]'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="text-xs text-[#e8e8f0]">{b.label}</span>
                    {activeBucket === b.key && (
                      <span className="ml-auto font-['DM_Mono',monospace] text-[9px] text-[#5a5a7a]">active</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="mx-3 my-1.5 border-t border-[#2a2a3a]" />

              {/* Thought process section */}
              <div className="px-3 pb-3">
                <div className="font-['DM_Mono',monospace] text-[9px] tracking-[0.25em] uppercase text-[#5a5a7a] mb-1.5 px-1">
                  Thought Process
                </div>
                {THOUGHT_DOCS.map(doc => (
                  <button
                    key={doc.key}
                    onClick={() => openModal(doc.key)}
                    className="w-full flex flex-col px-2 py-2 rounded-lg text-left hover:bg-[#22263a] transition-colors"
                  >
                    <span className="text-xs text-[#e8e8f0]">{doc.label}</span>
                    <span className="font-['DM_Mono',monospace] text-[10px] text-[#5a5a7a] mt-0.5">{doc.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Dashboard iframe */}
        <iframe
          ref={iframeRef}
          src="/take-homes/weave/index.html"
          className="w-full h-full border-0"
          title="Weave Engineering Impact Dashboard"
        />
      </div>

      {/* Modal */}
      {activeModal && (
        <ThoughtProcessModal doc={activeModal} onClose={() => setActiveModal(null)} />
      )}
    </div>
  );
};

export default WeaveTakeHome;
