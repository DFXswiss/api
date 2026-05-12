#!/usr/bin/env python3
"""Fetch all PRs David reviewed that are NOT in the existing JSONL (missing 1-commit PRs etc.)."""

import subprocess
import json
import os
import sys
import time

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = "DFXswiss/api"
DAVID = "davidleomay"

def gh_api(endpoint, paginate=False):
    cmd = f'gh api {endpoint}'
    if paginate:
        cmd += ' --paginate'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        try:
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

def fetch_all_david_reviewed_prs():
    """Fetch all PR numbers David reviewed via GraphQL search."""
    all_prs = []
    cursor = None

    while True:
        after = f', after: "{cursor}"' if cursor else ''
        query = f'''
        {{
          search(query: "repo:{REPO} is:pr reviewed-by:{DAVID}", type: ISSUE, first: 100{after}) {{
            pageInfo {{ hasNextPage endCursor }}
            edges {{
              node {{
                ... on PullRequest {{
                  number
                  title
                  author {{ login }}
                  state
                  baseRefName
                  createdAt
                }}
              }}
            }}
          }}
        }}
        '''

        result = subprocess.run(
            ['gh', 'api', 'graphql', '-f', f'query={query}'],
            capture_output=True, text=True
        )

        if result.returncode != 0:
            print(f"GraphQL error: {result.stderr}", file=sys.stderr)
            break

        data = json.loads(result.stdout)
        search = data['data']['search']

        for edge in search['edges']:
            node = edge['node']
            if node:
                all_prs.append({
                    'number': node['number'],
                    'title': node.get('title', ''),
                    'author': node.get('author', {}).get('login', ''),
                    'state': node.get('state', ''),
                    'base': node.get('baseRefName', ''),
                    'createdAt': node.get('createdAt', ''),
                })

        if not search['pageInfo']['hasNextPage']:
            break
        cursor = search['pageInfo']['endCursor']

        if len(all_prs) % 500 == 0:
            print(f"  Fetched {len(all_prs)} PR metadata...")

    return all_prs

def fetch_review_comments_for_pr(pr_number):
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
    reviews = gh_api(f'/repos/{REPO}/pulls/{pr_number}/reviews', paginate=True)
    if not reviews:
        return []
    david_reviews = []
    for r in reviews:
        if isinstance(r, dict) and r.get('user', {}).get('login') == DAVID:
            body = r.get('body', '').strip()
            if body:
                david_reviews.append({
                    "pr": pr_number,
                    "id": r.get("id"),
                    "state": r.get("state"),
                    "body": body,
                    "submitted_at": r.get("submitted_at"),
                })
    return david_reviews

def main():
    # Load existing PR numbers from first run
    jsonl_path = os.path.join(OUTPUT_DIR, '..', 'davidleomay-involved-prs.jsonl')
    with open(jsonl_path) as f:
        existing_prs = {json.loads(l)['number'] for l in f}
    print(f"Existing PRs from JSONL: {len(existing_prs)}")

    # Also load already-fetched PRs from first run
    progress_file = os.path.join(OUTPUT_DIR, "fetch_progress.json")
    already_fetched = set()
    if os.path.exists(progress_file):
        with open(progress_file) as f:
            already_fetched = set(json.load(f))
    print(f"Already fetched (run 1): {len(already_fetched)}")

    # Fetch all PRs David reviewed
    print("Fetching all PRs David reviewed via GraphQL...")
    all_reviewed = fetch_all_david_reviewed_prs()
    all_reviewed_numbers = {pr['number'] for pr in all_reviewed}
    print(f"Total PRs David reviewed: {len(all_reviewed_numbers)}")

    # Find missing PRs
    missing = sorted(all_reviewed_numbers - already_fetched)
    print(f"Missing PRs to fetch: {len(missing)}")

    # Also fetch David's authored PRs not in JSONL
    print("Fetching David's authored PRs...")
    authored_prs = []
    cursor = None
    while True:
        after = f', after: "{cursor}"' if cursor else ''
        query = f'''
        {{
          search(query: "repo:{REPO} is:pr author:{DAVID}", type: ISSUE, first: 100{after}) {{
            pageInfo {{ hasNextPage endCursor }}
            edges {{
              node {{
                ... on PullRequest {{
                  number
                }}
              }}
            }}
          }}
        }}
        '''
        result = subprocess.run(
            ['gh', 'api', 'graphql', '-f', f'query={query}'],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            break
        data = json.loads(result.stdout)
        search = data['data']['search']
        for edge in search['edges']:
            if edge['node']:
                authored_prs.append(edge['node']['number'])
        if not search['pageInfo']['hasNextPage']:
            break
        cursor = search['pageInfo']['endCursor']

    authored_missing = sorted(set(authored_prs) - already_fetched - set(missing))
    print(f"David's authored PRs not yet fetched: {len(authored_missing)}")

    # Combine all missing
    all_missing = sorted(set(missing) | set(authored_missing))
    print(f"Total PRs to fetch: {len(all_missing)}")

    # Check for existing progress (run 2)
    progress_file_2 = os.path.join(OUTPUT_DIR, "fetch_progress_2.json")
    done_prs = set()
    if os.path.exists(progress_file_2):
        with open(progress_file_2) as f:
            done_prs = set(json.load(f))
        print(f"Resuming run 2: {len(done_prs)} already done")

    remaining = [pr for pr in all_missing if pr not in done_prs]
    print(f"Remaining: {len(remaining)}")

    review_comments_file = os.path.join(OUTPUT_DIR, "david_review_comments_2.jsonl")
    review_bodies_file = os.path.join(OUTPUT_DIR, "david_review_bodies_2.jsonl")

    total_comments = 0
    total_bodies = 0
    errors = 0

    for i, pr_num in enumerate(remaining):
        if (i + 1) % 25 == 0 or i == 0:
            print(f"  Fetching PR #{pr_num} ({i+1}/{len(remaining)})...")

        try:
            comments = fetch_review_comments_for_pr(pr_num)
            if comments:
                with open(review_comments_file, 'a') as f:
                    for c in comments:
                        f.write(json.dumps(c) + '\n')
                total_comments += len(comments)

            reviews = fetch_reviews_for_pr(pr_num)
            if reviews:
                with open(review_bodies_file, 'a') as f:
                    for r in reviews:
                        f.write(json.dumps(r) + '\n')
                total_bodies += len(reviews)

            done_prs.add(pr_num)

            if (i + 1) % 50 == 0:
                with open(progress_file_2, 'w') as f:
                    json.dump(list(done_prs), f)

        except Exception as e:
            print(f"  Error on PR #{pr_num}: {e}", file=sys.stderr)
            errors += 1

        if (i + 1) % 100 == 0:
            time.sleep(1)

    with open(progress_file_2, 'w') as f:
        json.dump(list(done_prs), f)

    print(f"\nDone!")
    print(f"  New review comments: {total_comments}")
    print(f"  New review bodies: {total_bodies}")
    print(f"  Errors: {errors}")

if __name__ == "__main__":
    main()
