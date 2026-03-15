1. Feature owners (depth)
Own a subsystem end-to-end. Large PRs, concentrated in specific directories, long commit history in same files. Impact signal: PR size × complexity × ownership continuity.
2. Reviewers / gatekeepers
Unblock the team. High review volume, fast turnaround, substantive comments (not just approvals). Impact signal: reviews given × comment depth × others' PRs they touched that shipped.
3. Cross-cutting contributors (breadth)
Work across many features simultaneously. Touch infra, frontend, backend in same week. Impact signal: directory diversity × PR frequency × files changed across subsystems.
4. Bug fixers / reliability
Keep the product stable. Small targeted PRs, issue-linked commits, fast cycle time. Impact signal: issues closed × fix speed × recurrence rate.
5. Community managers (open source specific)
PostHog is open source — this bucket is critical and unique. Triage external PRs, respond to issues, review community contributions. Impact signal: external PR reviews + issue responses + community PR merges.
6. Force multipliers / mentors
Their reviews make other engineers better. Impact signal: comment quality (length/substance proxy), how often their review comments get addressed, junior PRs they reviewed that shipped cleanly.
7. Infrastructure / platform engineers
Enable everyone else. CI/CD, tooling, build system. Low visibility but high leverage. Impact signal: files changed in .github/, Makefile, infra dirs × downstream PRs unblocked.
