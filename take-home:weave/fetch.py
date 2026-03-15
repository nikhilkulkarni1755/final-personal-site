#!/usr/bin/env python3
"""
fetch.py - Fetch PostHog GitHub data and compute engineering impact scores.
Outputs data.json for the dashboard.
"""

import os
import json
import time
import math
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import urllib.request
import urllib.error

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
BASE_URL = "https://api.github.com"
REPO = "PostHog/posthog"
WINDOW_DAYS = 90
SLEEP_BETWEEN_CALLS = 0.02
MAX_PRS = 300  # cap for speed; still enough signal for top-5 ranking
BASE_BRANCH = "master"  # PostHog's default branch

INFRA_PATH_PATTERNS = [
    ".github/",
    "ci/",
    "docker",
    "Dockerfile",
    "Makefile",
    "requirements",
    "k8s/",
    "terraform/",
    "bin/",
    "scripts/",
    "plugin-server/",
]
INFRA_ROOT_EXTENSIONS = {".yml", ".yaml"}
INFRA_ROOT_FILES = {"package.json", "Makefile", "Dockerfile"}
DEPENDENCY_KEYWORDS = ["bump", "update", "upgrade", "chore(deps)"]


def make_request(url, retries=3):
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code == 403:
                wait = 60 * (attempt + 1)
                print(f"  Rate limited, waiting {wait}s...")
                time.sleep(wait)
            elif e.code == 404:
                return None
            else:
                print(f"  HTTP {e.code} for {url}, attempt {attempt+1}")
                if attempt == retries - 1:
                    return None
                time.sleep(2)
        except Exception as e:
            print(f"  Error fetching {url}: {e}, attempt {attempt+1}")
            if attempt == retries - 1:
                return None
            time.sleep(2)
    return None


def paginate(url_base, cutoff=None):
    """Paginate a list endpoint. If cutoff is set and items have created_at,
    stop as soon as we see an item older than cutoff."""
    results = []
    page = 1
    while True:
        sep = "&" if "?" in url_base else "?"
        url = f"{url_base}{sep}page={page}&per_page=100"
        data = make_request(url)
        if not data:
            break
        if isinstance(data, list):
            if cutoff:
                stop = False
                for item in data:
                    created = item.get("created_at")
                    if created:
                        dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                        if dt < cutoff:
                            stop = True
                            break
                    results.append(item)
                if stop:
                    break
            else:
                results.extend(data)
            if len(data) < 100:
                break
        else:
            results.append(data)
            break
        page += 1
        time.sleep(SLEEP_BETWEEN_CALLS)
    return results


def is_bot(username):
    if not username:
        return True
    return "[bot]" in username or username.endswith("-bot")


def is_infra_path(filepath):
    # root-level yml/yaml
    if "/" not in filepath:
        ext = os.path.splitext(filepath)[1].lower()
        if ext in INFRA_ROOT_EXTENSIONS:
            return True
        if filepath in INFRA_ROOT_FILES:
            return True
    # package.json at root
    if filepath == "package.json":
        return True
    for pattern in INFRA_PATH_PATTERNS:
        if filepath.startswith(pattern) or pattern in filepath:
            return True
    return False


def get_infra_subsystem(filepath):
    if filepath.startswith(".github/"):
        return ".github"
    if filepath.startswith("ci/"):
        return "ci"
    if filepath.startswith("k8s/"):
        return "k8s"
    if filepath.startswith("terraform/"):
        return "terraform"
    if filepath.startswith("bin/"):
        return "bin"
    if filepath.startswith("scripts/"):
        return "scripts"
    if filepath.startswith("plugin-server/"):
        return "plugin-server"
    if "docker" in filepath.lower() or "dockerfile" in filepath.lower():
        return "docker"
    if "requirements" in filepath.lower():
        return "requirements"
    if "/" not in filepath:
        ext = os.path.splitext(filepath)[1].lower()
        if ext in INFRA_ROOT_EXTENSIONS or filepath in INFRA_ROOT_FILES:
            return "root-config"
    return "other-infra"


def normalize(val, max_val):
    if max_val == 0:
        return 0
    return min(100, (val / max_val) * 100)


def main():
    if not GITHUB_TOKEN:
        print("WARNING: No GITHUB_TOKEN set. Rate limits will be very low.")

    cutoff = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    print(f"Fetching PRs for {REPO} since {cutoff.isoformat()}")

    # --- Step 1: Fetch all PRs in window ---
    print("\nFetching PRs...")
    all_prs_raw = paginate(
        f"{BASE_URL}/repos/{REPO}/pulls?state=all&base={BASE_BRANCH}&sort=created&direction=desc",
        cutoff=cutoff
    )

    # Filter bots first
    prs_in_window = [
        pr for pr in all_prs_raw
        if not is_bot(pr["user"]["login"] if pr.get("user") else None)
    ]
    print(f"PRs targeting {BASE_BRANCH} in last {WINDOW_DAYS} days (after bot filter): {len(prs_in_window)}")

    # If on master and total exceeds cap, take the most recent MAX_PRS only.
    # PRs are already sorted newest-first (sort=created&direction=desc).
    if BASE_BRANCH == "master" and len(prs_in_window) > MAX_PRS:
        prs = prs_in_window[:MAX_PRS]
        print(f"Capping to most recent {MAX_PRS} PRs (master branch, {len(prs_in_window)} total exceeded cap)")
    else:
        prs = prs_in_window
        print(f"Using all {len(prs)} PRs (under cap)")

    # --- Step 2: Per-PR detail fetch ---
    pr_details = {}  # pr_number -> {files, reviews, requested_reviewers}

    for i, pr in enumerate(prs):
        num = pr["number"]
        print(f"  Fetching PR {i+1}/{len(prs)} (#{num})...", end="\r")

        files = make_request(f"{BASE_URL}/repos/{REPO}/pulls/{num}/files?per_page=100") or []
        time.sleep(SLEEP_BETWEEN_CALLS)
        reviews = make_request(f"{BASE_URL}/repos/{REPO}/pulls/{num}/reviews?per_page=100") or []
        time.sleep(SLEEP_BETWEEN_CALLS)
        req_reviewers_data = make_request(f"{BASE_URL}/repos/{REPO}/pulls/{num}/requested_reviewers") or {}
        time.sleep(SLEEP_BETWEEN_CALLS)

        pr_details[num] = {
            "files": files,
            "reviews": reviews,
            "requested_reviewers": req_reviewers_data.get("users", []) if isinstance(req_reviewers_data, dict) else [],
        }

    print(f"\nFetched details for {len(pr_details)} PRs")

    # --- Step 3: Aggregate per-engineer data ---
    # Author data
    author_prs = defaultdict(list)           # username -> list of PR dicts
    author_files = defaultdict(list)         # username -> list of file paths
    author_file_counts = defaultdict(lambda: defaultdict(int))  # username -> filepath -> count
    author_dir_counts = defaultdict(lambda: defaultdict(int))   # username -> top-dir -> count

    # Reviewer data
    reviewer_reviews = defaultdict(list)     # username -> list of review dicts with pr context
    reviewer_prs_reviewed = defaultdict(set) # username -> set of pr numbers reviewed
    reviewer_authors = defaultdict(set)      # username -> set of pr authors reviewed
    reviewer_requested = defaultdict(int)    # username -> times explicitly requested

    for pr in prs:
        author = pr["user"]["login"] if pr.get("user") else None
        if not author or is_bot(author):
            continue

        num = pr["number"]
        detail = pr_details.get(num, {})
        files = detail.get("files", [])
        reviews = detail.get("reviews", [])
        req_reviewers = detail.get("requested_reviewers", [])

        # Author aggregation
        author_prs[author].append(pr)

        for f in files:
            fp = f.get("filename", "")
            author_files[author].append(fp)
            author_file_counts[author][fp] += 1
            # top-level directory
            top_dir = fp.split("/")[0] if "/" in fp else "_root"
            author_dir_counts[author][top_dir] += 1

        # Reviewer aggregation
        pr_created_at = datetime.fromisoformat(pr["created_at"].replace("Z", "+00:00"))

        for review in reviews:
            reviewer = review.get("user", {}).get("login") if review.get("user") else None
            if not reviewer or is_bot(reviewer) or reviewer == author:
                continue

            review_submitted = review.get("submitted_at", "")

            reviewer_reviews[reviewer].append({
                "pr_number": num,
                "pr_title": pr.get("title", ""),
                "pr_url": pr.get("html_url", ""),
                "state": review.get("state", ""),
                "body": review.get("body", "") or "",
                "pr_created_at": pr_created_at,
                "submitted_at": review_submitted,
                "pr_merged": pr.get("merged_at") is not None,
                "pr_author": author,
            })
            reviewer_prs_reviewed[reviewer].add(num)
            reviewer_authors[reviewer].add(author)

        # Requested reviewers
        for rr in req_reviewers:
            rr_login = rr.get("login", "")
            if rr_login and not is_bot(rr_login):
                reviewer_requested[rr_login] += 1

    # --- Step 4: Fetch user profiles (cached) ---
    print("\nFetching user profiles...")
    all_users = set(author_prs.keys()) | set(reviewer_reviews.keys())
    user_profiles = {}

    for i, username in enumerate(all_users):
        print(f"  Fetching profile {i+1}/{len(all_users)}: {username}", end="\r")
        profile = make_request(f"{BASE_URL}/users/{username}")
        if profile:
            user_profiles[username] = {
                "name": profile.get("name") or username,
                "avatar_url": profile.get("avatar_url", ""),
            }
        time.sleep(SLEEP_BETWEEN_CALLS)
    print(f"\nFetched {len(user_profiles)} profiles")

    # --- Step 5: Compute metrics per engineer ---
    engineers = {}

    # Collect all usernames with enough activity
    candidate_users = set()
    for u in author_prs:
        if len(author_prs[u]) >= 3:
            candidate_users.add(u)
    for u in reviewer_reviews:
        if len(reviewer_prs_reviewed[u]) >= 3:
            candidate_users.add(u)

    print(f"\nComputing metrics for {len(candidate_users)} engineers...")

    for username in candidate_users:
        prs_authored = author_prs.get(username, [])
        merged_prs = [p for p in prs_authored if p.get("merged_at") is not None]

        # Feature owner metrics
        total_authored = len(prs_authored)
        total_merged = len(merged_prs)
        merge_rate = total_merged / total_authored if total_authored > 0 else 0

        files_touched = author_files.get(username, [])
        file_counts = author_file_counts.get(username, {})
        repeat_files = [f for f, c in file_counts.items() if c >= 3]

        dir_counts = author_dir_counts.get(username, {})
        total_file_refs = sum(dir_counts.values())
        if total_file_refs > 0:
            max_dir_count = max(dir_counts.values()) if dir_counts else 0
            dir_concentration = max_dir_count / total_file_refs
            primary_subsystem = max(dir_counts, key=dir_counts.get) if dir_counts else ""
        else:
            dir_concentration = 0
            primary_subsystem = ""

        total_additions = sum(p.get("additions", 0) for p in prs_authored)
        total_deletions = sum(p.get("deletions", 0) for p in prs_authored)
        avg_pr_size = (total_additions + total_deletions) / total_authored if total_authored > 0 else 0

        # Infra metrics
        infra_prs = []
        for pr in prs_authored:
            num = pr["number"]
            files = pr_details.get(num, {}).get("files", [])
            filepaths = [f.get("filename", "") for f in files]
            if any(is_infra_path(fp) for fp in filepaths):
                infra_prs.append(pr)

        infra_count = len(infra_prs)
        infra_ratio = infra_count / total_authored if total_authored > 0 else 0
        infra_merged = len([p for p in infra_prs if p.get("merged_at") is not None])
        infra_merge_rate = infra_merged / infra_count if infra_count > 0 else 0

        dep_update_prs = [
            p for p in prs_authored
            if any(kw in (p.get("title") or "").lower() for kw in DEPENDENCY_KEYWORDS)
        ]

        infra_subsystems = set()
        cicd_changes = 0
        for pr in infra_prs:
            num = pr["number"]
            files = pr_details.get(num, {}).get("files", [])
            for f in files:
                fp = f.get("filename", "")
                if is_infra_path(fp):
                    infra_subsystems.add(get_infra_subsystem(fp))
                if fp.startswith(".github/workflows"):
                    cicd_changes += 1

        # Reviewer metrics
        reviews_given = reviewer_reviews.get(username, [])
        prs_reviewed_set = reviewer_prs_reviewed.get(username, set())
        unique_authors_reviewed = reviewer_authors.get(username, set())
        times_requested = reviewer_requested.get(username, 0)

        changes_requested = [r for r in reviews_given if r["state"] == "CHANGES_REQUESTED"]
        approved = [r for r in reviews_given if r["state"] == "APPROVED"]

        # Avg comment count (non-empty body reviews)
        reviews_with_comments = [r for r in reviews_given if len(r["body"].strip()) > 50]
        avg_comment_substance = len(reviews_with_comments) / len(reviews_given) if reviews_given else 0

        # Review speed: avg hours from PR created to first review by this reviewer
        review_speeds = []
        first_reviews = {}  # pr_number -> earliest review time
        for r in reviews_given:
            pr_num = r["pr_number"]
            if r["submitted_at"]:
                try:
                    submitted = datetime.fromisoformat(r["submitted_at"].replace("Z", "+00:00"))
                    pr_created = r["pr_created_at"]
                    hours = (submitted - pr_created).total_seconds() / 3600
                    if pr_num not in first_reviews or hours < first_reviews[pr_num]:
                        first_reviews[pr_num] = hours
                except Exception:
                    pass
        review_speeds = list(first_reviews.values())
        avg_review_speed_hours = sum(review_speeds) / len(review_speeds) if review_speeds else 999

        # PR merge rate for PRs reviewed
        reviewed_prs_data = [p for p in prs if p["number"] in prs_reviewed_set]
        reviewed_merged = len([p for p in reviewed_prs_data if p.get("merged_at") is not None])
        reviewed_merge_rate = reviewed_merged / len(prs_reviewed_set) if prs_reviewed_set else 0

        # Top PRs (by additions+deletions for authors, or by substance for reviewers)
        sorted_authored = sorted(prs_authored, key=lambda p: p.get("additions", 0) + p.get("deletions", 0), reverse=True)
        top_prs = [
            {"number": p["number"], "title": p.get("title", ""), "url": p.get("html_url", "")}
            for p in sorted_authored[:3]
        ]

        # Top files
        top_files = sorted(file_counts.keys(), key=lambda f: file_counts[f], reverse=True)[:5]

        metrics = {
            # Feature owner
            "prs_authored": total_authored,
            "prs_merged": total_merged,
            "merge_rate": round(merge_rate, 3),
            "directory_concentration": round(dir_concentration, 3),
            "repeat_files_count": len(repeat_files),
            "repeat_files": repeat_files[:10],
            "avg_pr_size": round(avg_pr_size, 0),
            "primary_subsystem": primary_subsystem,
            # Reviewer
            "reviews_given": len(reviews_given),
            "prs_reviewed": len(prs_reviewed_set),
            "changes_requested_count": len(changes_requested),
            "approved_count": len(approved),
            "changes_requested_ratio": round(len(changes_requested) / len(reviews_given) if reviews_given else 0, 3),
            "unique_authors_reviewed": len(unique_authors_reviewed),
            "avg_comment_substance_ratio": round(avg_comment_substance, 3),
            "avg_review_speed_hours": round(avg_review_speed_hours, 1),
            "reviewed_merge_rate": round(reviewed_merge_rate, 3),
            "times_requested_as_reviewer": times_requested,
            # Infra
            "infra_prs_count": infra_count,
            "infra_pr_ratio": round(infra_ratio, 3),
            "infra_merge_rate": round(infra_merge_rate, 3),
            "dep_update_prs_count": len(dep_update_prs),
            "cicd_file_changes": cicd_changes,
            "infra_subsystems": list(infra_subsystems),
            "infra_subsystem_count": len(infra_subsystems),
        }

        profile = user_profiles.get(username, {"name": username, "avatar_url": ""})

        engineers[username] = {
            "username": username,
            "name": profile["name"],
            "avatar_url": profile["avatar_url"],
            "primary_bucket": None,  # filled later
            "scores": {"feature_owner": None, "reviewer": None, "infra": None},
            "primary_reason": "",
            "metrics": metrics,
            "top_prs": top_prs,
            "top_files": top_files,
        }

    # --- Step 6: Normalize scores ---
    print("Computing normalized scores...")

    # Gather maximums for normalization
    max_pr_volume = max((e["metrics"]["prs_authored"] for e in engineers.values()), default=1)
    max_review_volume = max((e["metrics"]["reviews_given"] for e in engineers.values()), default=1)
    max_repeat_files = max((e["metrics"]["repeat_files_count"] for e in engineers.values()), default=1)
    max_unique_authors = max((e["metrics"]["unique_authors_reviewed"] for e in engineers.values()), default=1)
    max_avg_comments = max((e["metrics"]["avg_comment_substance_ratio"] for e in engineers.values()), default=1)
    max_infra_volume = max((e["metrics"]["infra_prs_count"] for e in engineers.values()), default=1)
    max_infra_subsystems = max((e["metrics"]["infra_subsystem_count"] for e in engineers.values()), default=1)

    for username, eng in engineers.items():
        m = eng["metrics"]

        # Feature owner score
        fo_score = (
            m["merge_rate"] * 30 +
            m["directory_concentration"] * 25 +
            normalize(m["repeat_files_count"], max_repeat_files) / 100 * 25 +
            normalize(m["prs_authored"], max_pr_volume) / 100 * 20
        )

        # Only assign feature owner score if they have enough authored PRs
        eng["scores"]["feature_owner"] = round(fo_score, 1) if m["prs_authored"] >= 3 else None

        # Reviewer score
        if m["reviews_given"] >= 3:
            rev_score = (
                normalize(m["reviews_given"], max_review_volume) / 100 * 25 +
                m["changes_requested_ratio"] * 30 * 100 / 100 +  # already 0-1, scale to 0-30
                normalize(m["avg_comment_substance_ratio"], max_avg_comments) / 100 * 25 +
                normalize(m["unique_authors_reviewed"], max_unique_authors) / 100 * 20
            )
            # Fix: changes_requested_ratio is 0-1, multiply by 30 directly
            rev_score = (
                normalize(m["reviews_given"], max_review_volume) / 100 * 25 +
                m["changes_requested_ratio"] * 30 +
                normalize(m["avg_comment_substance_ratio"], max_avg_comments) / 100 * 25 +
                normalize(m["unique_authors_reviewed"], max_unique_authors) / 100 * 20
            )
            eng["scores"]["reviewer"] = round(rev_score, 1)
        else:
            eng["scores"]["reviewer"] = None

        # Infra score
        if m["infra_prs_count"] >= 1:
            infra_score = (
                m["infra_pr_ratio"] * 35 +
                normalize(m["infra_prs_count"], max_infra_volume) / 100 * 35 +
                normalize(m["infra_subsystem_count"], max_infra_subsystems) / 100 * 30
            )
            eng["scores"]["infra"] = round(infra_score, 1)
        else:
            eng["scores"]["infra"] = None

        # Primary bucket = highest score
        scores_available = {k: v for k, v in eng["scores"].items() if v is not None}
        if scores_available:
            primary = max(scores_available, key=scores_available.get)
            eng["primary_bucket"] = primary
        else:
            eng["primary_bucket"] = "feature_owner"

        # Primary reason
        bucket = eng["primary_bucket"]
        if bucket == "feature_owner":
            eng["primary_reason"] = (
                f"Authored {m['prs_authored']} PRs ({m['prs_merged']} merged) with "
                f"{round(m['directory_concentration']*100)}% focus in '{m['primary_subsystem']}'; "
                f"owns {m['repeat_files_count']} repeat files."
            )
        elif bucket == "reviewer":
            eng["primary_reason"] = (
                f"Gave {m['reviews_given']} reviews across {m['unique_authors_reviewed']} unique authors; "
                f"requested changes {m['changes_requested_count']} times ({round(m['changes_requested_ratio']*100)}% of reviews)."
            )
        else:
            eng["primary_reason"] = (
                f"Drove {m['infra_prs_count']} infra PRs ({round(m['infra_pr_ratio']*100)}% of total); "
                f"touched {m['infra_subsystem_count']} infra subsystems: {', '.join(list(m['infra_subsystems'])[:3])}."
            )

    # --- Step 7: Rank top 5 per bucket ---
    def top5_by_bucket(bucket_key):
        ranked = sorted(
            [(u, eng["scores"][bucket_key]) for u, eng in engineers.items() if eng["scores"].get(bucket_key) is not None],
            key=lambda x: x[1],
            reverse=True
        )
        return [u for u, _ in ranked[:5]]

    top_feature = top5_by_bucket("feature_owner")
    top_reviewer = top5_by_bucket("reviewer")
    top_infra = top5_by_bucket("infra")

    # Top 5 overall: top per primary bucket, ensuring at least 1 from each bucket
    # Get best per bucket first, then fill remaining slots
    top_overall_set = set()

    # Ensure at least 1 from each bucket if data supports
    for bucket_list in [top_feature, top_reviewer, top_infra]:
        if bucket_list:
            top_overall_set.add(bucket_list[0])

    # Fill remaining slots from all engineers sorted by their primary bucket score
    all_ranked = sorted(
        engineers.items(),
        key=lambda x: x[1]["scores"].get(x[1]["primary_bucket"]) or 0,
        reverse=True
    )
    for username, eng in all_ranked:
        if len(top_overall_set) >= 5:
            break
        top_overall_set.add(username)

    top_overall = []
    # Order them by their primary score descending
    top_overall = sorted(
        list(top_overall_set),
        key=lambda u: engineers[u]["scores"].get(engineers[u]["primary_bucket"]) or 0,
        reverse=True
    )

    # Only include engineers who appear in top_overall or top bucket lists in final output
    # (keep all for completeness but mark top)
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_days": WINDOW_DAYS,
        "repo": REPO,
        "top_overall": top_overall,
        "top_by_bucket": {
            "feature_owner": top_feature,
            "reviewer": top_reviewer,
            "infra": top_infra,
        },
        "engineers": engineers,
    }

    out_path = os.path.join(os.path.dirname(__file__), "dist", "data.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, default=str)

    print(f"\nWrote {out_path}")
    print(f"\nTop 5 overall: {top_overall}")
    print(f"Top feature owners: {top_feature}")
    print(f"Top reviewers: {top_reviewer}")
    print(f"Top infra: {top_infra}")
    print(f"\nTotal engineers analyzed: {len(engineers)}")


if __name__ == "__main__":
    main()
