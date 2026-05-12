#!/usr/bin/env python3
"""Phase 2: Fetch David's review comments from GitHub API for all PRs he reviewed."""

import subprocess
import json
import os
import sys
import time

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = "DFXswiss/api"
DAVID = "davidleomay"

def gh_api(endpoint, paginate=False):
    """Call GitHub API via gh CLI."""
    cmd = f'gh api {endpoint}'
    if paginate:
        cmd += ' --paginate'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        # Paginated results may be concatenated JSON arrays
        try:
            # Try to handle concatenated arrays: [...][\n][...]
            combined = []
            for chunk in result.stdout.strip().split('\n'):
                if chunk.strip():
                    parsed = json.loads(chunk)
                    if isinstance(parsed, list):
                        combined.extend(parsed)
                    else:
                        combined.append(parsed)
            return combined
        except json.JSONDecodeError:
            return None

def fetch_review_comments_for_pr(pr_number):
    """Fetch all review comments (inline code comments) on a PR by David."""
    comments = gh_api(f'/repos/{REPO}/pulls/{pr_number}/comments', paginate=True)
    if not comments:
        return []

    david_comments = []
    for c in comments:
        if isinstance(c, dict) and c.get('user', {}).get('login') == DAVID:
            david_comments.append({
                "pr": pr_number,
                "id": c.get("id"),
                "path": c.get("path"),
                "line": c.get("line") or c.get("original_line"),
                "side": c.get("side"),
                "body": c.get("body"),
                "diff_hunk": c.get("diff_hunk"),
                "created_at": c.get("created_at"),
                "in_reply_to_id": c.get("in_reply_to_id"),
            })
    return david_comments

def fetch_reviews_for_pr(pr_number):
    """Fetch review bodies (approve/request changes with comment) by David."""
    reviews = gh_api(f'/repos/{REPO}/pulls/{pr_number}/reviews', paginate=True)
    if not reviews:
        return []

    david_reviews = []
    for r in reviews:
        if isinstance(r, dict) and r.get('user', {}).get('login') == DAVID:
            body = r.get('body', '').strip()
            if body:  # Only save reviews with actual text
                david_reviews.append({
                    "pr": pr_number,
                    "id": r.get("id"),
                    "state": r.get("state"),
                    "body": body,
                    "submitted_at": r.get("submitted_at"),
                })
    return david_reviews

def fetch_issue_comments_for_pr(pr_number):
    """Fetch PR-level (issue) comments by David."""
    comments = gh_api(f'/repos/{REPO}/issues/{pr_number}/comments', paginate=True)
    if not comments:
        return []

    david_comments = []
    for c in comments:
        if isinstance(c, dict) and c.get('user', {}).get('login') == DAVID:
            david_comments.append({
                "pr": pr_number,
                "id": c.get("id"),
                "body": c.get("body"),
                "created_at": c.get("created_at"),
            })
    return david_comments

def main():
    # Load PR data
    jsonl_path = os.path.join(OUTPUT_DIR, '..', 'davidleomay-involved-prs.jsonl')
    with open(jsonl_path) as f:
        all_prs = [json.loads(l) for l in f]

    # PRs where David reviewed (others' PRs)
    reviewed_prs = [d for d in all_prs if d['davidleomayReviewed'] and d['author'] != DAVID]
    # PRs where David commented
    commented_prs = [d for d in all_prs if d['davidleomayCommented']]

    # Combine unique PR numbers to fetch
    pr_numbers_review = {d['number'] for d in reviewed_prs}
    pr_numbers_comment = {d['number'] for d in commented_prs}
    all_pr_numbers = sorted(pr_numbers_review | pr_numbers_comment)

    print(f"PRs to fetch: {len(all_pr_numbers)} ({len(pr_numbers_review)} reviewed, {len(pr_numbers_comment)} commented)")

    # Check for existing progress
    progress_file = os.path.join(OUTPUT_DIR, "fetch_progress.json")
    done_prs = set()
    if os.path.exists(progress_file):
        with open(progress_file) as f:
            done_prs = set(json.load(f))
        print(f"Resuming: {len(done_prs)} PRs already fetched")

    remaining = [pr for pr in all_pr_numbers if pr not in done_prs]
    print(f"Remaining: {len(remaining)} PRs")

    # Output files (append mode)
    review_comments_file = os.path.join(OUTPUT_DIR, "david_review_comments.jsonl")
    review_bodies_file = os.path.join(OUTPUT_DIR, "david_review_bodies.jsonl")
    issue_comments_file = os.path.join(OUTPUT_DIR, "david_issue_comments.jsonl")

    total_review_comments = 0
    total_review_bodies = 0
    total_issue_comments = 0
    errors = 0

    for i, pr_num in enumerate(remaining):
        if (i + 1) % 25 == 0 or i == 0:
            print(f"  Fetching PR #{pr_num} ({i+1}/{len(remaining)})...")

        try:
            # Fetch review comments (inline)
            if pr_num in pr_numbers_review:
                comments = fetch_review_comments_for_pr(pr_num)
                if comments:
                    with open(review_comments_file, 'a') as f:
                        for c in comments:
                            f.write(json.dumps(c) + '\n')
                    total_review_comments += len(comments)

                # Fetch review bodies
                reviews = fetch_reviews_for_pr(pr_num)
                if reviews:
                    with open(review_bodies_file, 'a') as f:
                        for r in reviews:
                            f.write(json.dumps(r) + '\n')
                    total_review_bodies += len(reviews)

            # Fetch issue comments
            if pr_num in pr_numbers_comment:
                comments = fetch_issue_comments_for_pr(pr_num)
                if comments:
                    with open(issue_comments_file, 'a') as f:
                        for c in comments:
                            f.write(json.dumps(c) + '\n')
                    total_issue_comments += len(comments)

            done_prs.add(pr_num)

            # Save progress every 50 PRs
            if (i + 1) % 50 == 0:
                with open(progress_file, 'w') as f:
                    json.dump(list(done_prs), f)

        except Exception as e:
            print(f"  Error on PR #{pr_num}: {e}", file=sys.stderr)
            errors += 1

        # Small delay to be nice to the API
        if (i + 1) % 100 == 0:
            time.sleep(1)

    # Final progress save
    with open(progress_file, 'w') as f:
        json.dump(list(done_prs), f)

    print(f"\nDone!")
    print(f"  Review comments (inline): {total_review_comments}")
    print(f"  Review bodies: {total_review_bodies}")
    print(f"  Issue comments: {total_issue_comments}")
    print(f"  Errors: {errors}")

if __name__ == "__main__":
    main()
