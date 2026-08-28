# PostHog Engineering Impact — take-home

[back](/) PH PostHog Engineering Impact take-home posthog/posthog 90-day window Feature Owners Feature Owners Engineers who own subsystems end-to-end with depth and continuity Matt Pua [@MattPua](https://github.com/MattPua) #1 Feature Owner Score

Authored 14 PRs (8 merged) with 97% focus in 'frontend'; owns 3 repeat files.

Top PRs [#51009feat(dashboard): disable editing title/description on dashboards when entering edit layout mode](https://github.com/PostHog/posthog/pull/51009) [#51008chore: update codeowners for dashboards](https://github.com/PostHog/posthog/pull/51008) [#51007feat: add bounded for drag config in dashboard](https://github.com/PostHog/posthog/pull/51007) ▾ expand Phil Haack [@haacked](https://github.com/haacked) #2 Feature Owner Score

Authored 13 PRs (9 merged) with 59% focus in 'rust'; owns 3 repeat files.

Top PRs [#51070feat(flags): replace auth cache warming with lazy per-token ReadThroughCache](https://github.com/PostHog/posthog/pull/51070) [#51069feat(flags): pre-compute flag dependencies in the Django hypercache](https://github.com/PostHog/posthog/pull/51069) [#51055feat: track personal API key auth source on local evaluation endpoint](https://github.com/PostHog/posthog/pull/51055) ▾ expand Julian Bez [@webjunkie](https://github.com/webjunkie) #3 Feature Owner Score

Drove 10 infra PRs (67% of total); touched 4 infra subsystems: bin, .github, docker.

Top PRs [#51040fix(devex): relax zero-reviews rule for low-risk PRs](https://github.com/PostHog/posthog/pull/51040) [#50999fix(devex): pr-approval-agent tuning and label retention](https://github.com/PostHog/posthog/pull/50999) [#50994fix(ci): remove redundant OpenAPI type generation in check-migrations](https://github.com/PostHog/posthog/pull/50994) ▾ expand Tom Piccirello [@Piccirello](https://github.com/Piccirello) #4 Feature Owner Score

Authored 12 PRs (11 merged) with 72% focus in 'posthog'; owns 1 repeat files.

Top PRs [#51071chore: disable egress proxy in prometheus client](https://github.com/PostHog/posthog/pull/51071) [#51043fix: bypass egress proxy when connecting to Clickhouse](https://github.com/PostHog/posthog/pull/51043) [#51004fix: bypass egress proxy when connecting to Clickhouse](https://github.com/PostHog/posthog/pull/51004) ▾ expand Marius Andra [@mariusandra](https://github.com/mariusandra) #5 Feature Owner Score

Authored 3 PRs (3 merged) with 77% focus in 'posthog'; owns 2 repeat files.

Top PRs [#50969fix(hogql): support nested join key expressions](https://github.com/PostHog/posthog/pull/50969) [#50923fix(warehouse): duplicate events table issue](https://github.com/PostHog/posthog/pull/50923) [#50902feat(ducklake): sql editor connection settings](https://github.com/PostHog/posthog/pull/50902) ▾ expand
          Scores are normalized within each bucket. See data decisions 59 engineers · PostHog/posthog

## Engineering Impact Categories

Before writing scoring logic, I mapped 7 distinct engineering impact archetypes. The dashboard implements 3 — the ones with the strongest GitHub signal.

1. Feature Owners (depth)

Own a subsystem end-to-end. Large PRs, concentrated in specific directories, long commit history in same files.

signal: PR size × complexity × ownership continuity 2. Reviewers / Gatekeepers

Unblock the team. High review volume, fast turnaround, substantive comments (not just approvals).

signal: reviews given × comment depth × others' PRs they touched that shipped 3. Cross-cutting Contributors

Work across many features simultaneously. Touch infra, frontend, backend in the same week.

signal: directory diversity × PR frequency × files changed across subsystems 4. Bug Fixers / Reliability

Keep the product stable. Small targeted PRs, issue-linked commits, fast cycle time.

signal: issues closed × fix speed × recurrence rate 5. Community Managers

PostHog is open source — a unique bucket. Triage external PRs, respond to issues, review community contributions.

signal: external PR reviews + issue responses + community PR merges 6. Force Multipliers / Mentors

Their reviews make other engineers better. Impact flows through review quality.

signal: comment quality (length/substance), junior PRs they reviewed that shipped cleanly 7. Infrastructure / Platform

Enable everyone else. CI/CD, tooling, build system. Low visibility but high leverage.

signal: files changed in .github/, Makefile, infra dirs × downstream PRs unblocked

## Future TODOs

Two high-priority improvements I'd tackle given more time.

1. Keep data fresh via cron

Set up a daily/weekly cron job that re-runs fetch.py, writes results to a small DB, and exposes an API endpoint. The frontend fetches from that instead of a static data.json — so rankings always reflect the last N days automatically.

2. Implement more engineering categories

The 7-category framework covers far more than the current 3. Adding cross-cutting contributors, bug fixers, and community managers would give a fuller picture — especially relevant for PostHog given its open-source model.

## Data Fetch — Issues & Decisions

Four concrete issues hit during data collection — each with a decision and reasoning.

Issue 1 Fetching all PRs before date-filtering Problem

Initial paginate() downloaded the entire PR history before applying the 90-day filter — 6421 PRs from a repo with 37k+ total commits.

Decision

Added a cutoff parameter to paginate() that stops at the API level as soon as an item older than the cutoff is encountered.

Why

Early termination cuts both total API calls and runtime proportionally. For this repo, the difference is between minutes and hours.

Issue 2 6419 PRs in 90 days = hours of runtime Problem

Even with early termination, ~6400 non-bot PRs in 90 days. At 0.05s sleep: 6419 × 3 × 0.05s ≈ 16 min in sleep alone, total ~5+ hours.

Decision

Added MAX_PRS = 300 and reduced SLEEP from 0.05s → 0.02s. Cap applies when base is master and PR count exceeds 300, taking the most recent 300.

Why

300 PRs is sufficient to identify the top 5. 0.02s sleep keeps us under GitHub's 5000 req/hr limit. Trade-off: engineers active earlier in the window but not in the most recent 300 will be under-represented.

Issue 3 Transient HTTP 500 from GitHub API Problem

During the first run, one PR's /files endpoint returned HTTP 500.

Decision

No code change needed — existing retry logic (3 attempts with backoff) handled it automatically.

Why

500s from GitHub are transient. If a PR's detail fetch ultimately fails, that PR contributes no file/review data but is still counted — graceful degradation.

Issue 4 PRs not filtered to main branch Problem

Initial API call fetched PRs targeting any base branch — feature branches, release branches, etc. This inflated PR counts with work that never lands in production.

Decision

Added &base=master to the pulls API call. BASE_BRANCH exposed as a constant for easy adjustment.

Why

Engineering impact should be measured by work that lands in the main codebase. Filtering to master ensures metrics reflect production-bound work only.

Final Parameters WINDOW_DAYS 90 Assignment spec MAX_PRS 300 Runtime constraint — sufficient for top-5 ranking SLEEP_BETWEEN_CALLS 0.02s Safe under 5000 req/hr; keeps runtime ~10 min BASE_BRANCH master Only PRs targeting PostHog's main branch MIN_PRS_THRESHOLD 3 Exclude engineers with too little signal Retries per call 3 Handle transient GitHub 500s/429s
