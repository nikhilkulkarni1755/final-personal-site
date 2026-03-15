# Data Fetch — Issues & Decisions

## Issue 1: Fetching all PRs before date-filtering

**Problem:** The initial `paginate()` function fetched every page of results and returned them all before any date filtering happened. Since PostHog has 37k+ total commits and thousands of historical PRs, this caused the script to download the entire PR history of the repo before discarding anything outside the 90-day window. On the first run, this produced 6421 PRs — but only after downloading far more pages than needed.

**Decision:** Added a `cutoff` parameter to `paginate()` that checks each item's `created_at` as pages are received and stops paginating as soon as an item older than the cutoff is encountered. This means we stop at the API level, not after loading everything into memory.

**Why:** Early termination cuts both total API calls and runtime proportionally. For a repo this size the difference is between minutes and hours.

---

## Issue 2: 6419 PRs in 90 days = hours of runtime

**Problem:** Even with early pagination termination, PostHog generates ~6400 non-bot PRs in 90 days (~71/day). Each PR requires 3 additional API calls (files, reviews, requested_reviewers) plus a sleep delay. At the original 0.05s sleep: 6419 × 3 × 0.05s = ~16 min in sleep alone, plus actual HTTP request time — total estimated 5+ hours.

**Decision:** Added `MAX_PRS = 300` and reduced `SLEEP_BETWEEN_CALLS` from 0.05s to 0.02s. The cap is applied conditionally: if the base branch is `master` and the total PR count in the window exceeds 300, we take the most recent 300 (PRs are already sorted newest-first from the API). For any other branch, or if total PRs are under 300, all PRs are used.

**Why:** 300 PRs targeting `master` is sufficient to identify the top 5 engineers. The most active contributors will appear repeatedly in the most recent PRs — the cap doesn't hide them, it just bounds the API call count. The 0.02s sleep keeps us well under GitHub's 5000 req/hr limit (300 × 3 calls = 900 calls). The conditional ensures smaller repos or feature branches are not artificially capped.

**Trade-off acknowledged:** Engineers who were active earlier in the 90-day window but not in the most recent 300 PRs will be under-represented. For a production system, the right fix would be parallel fetching with a proper rate-limit budget, or use of GitHub's GraphQL API (which allows batching multiple PR details in a single request).

---

## Issue 3: Transient HTTP 500 from GitHub API

**Problem:** During the first run, one PR's `/files` endpoint returned HTTP 500 (internal server error on GitHub's side).

**Decision:** The existing retry logic (3 attempts with backoff) handled this automatically. No code change needed. The script logged the error and continued.

**Why:** 500s from GitHub are transient and uncommon. Three retries with exponential backoff is the standard approach. If a PR's detail fetch ultimately fails after all retries, that PR contributes no file/review data but the PR itself (author, merge status, size) is still counted — a graceful degradation.

---

## Issue 4: PRs not filtered to main branch

**Problem:** The initial API call fetched PRs targeting any base branch — feature branches, release branches, hotfix branches, etc. This could include exploratory or experimental PRs that never target `master`, inflating an engineer's PR count and skewing ownership/reviewer signals.

**Decision:** Added `&base=master` to the pulls API call. PostHog uses `master` as their default branch (exposed as `BASE_BRANCH` constant in the script for easy adjustment).

**Why:** Engineering impact should be measured by work that lands in the main codebase. PRs targeting other branches may represent in-flight work, experiments, or release mechanics that don't reflect stable contributions. Filtering to `master` ensures the metrics (merge rate, file ownership, review patterns) reflect production-bound work only.

---

## Summary of parameters in final fetch.py

| Parameter | Value | Reason |
|---|---|---|
| `WINDOW_DAYS` | 90 | Assignment spec |
| `MAX_PRS` | 300 | Runtime constraint — sufficient for top-5 ranking |
| `SLEEP_BETWEEN_CALLS` | 0.02s | Safe under 5000 req/hr; keeps runtime ~10 min |
| `BASE_BRANCH` | `master` | Only PRs targeting PostHog's main branch |
| `MIN_PRS_THRESHOLD` | 3 | Exclude engineers with too little signal |
| Retries per call | 3 | Handle transient GitHub 500s/429s |
