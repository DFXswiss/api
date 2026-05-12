#!/usr/bin/env python3
"""Phase 1: Extract all of David's commits with diffs from local git history."""

import subprocess
import json
import os

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
AUTHOR_EMAIL = "85513542+davidleomay@users.noreply.github.com"

def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.stdout

def get_david_commits():
    """Get all commit hashes by David."""
    output = run(f'git log --all --author="{AUTHOR_EMAIL}" --format="%H"')
    return [h.strip() for h in output.strip().split('\n') if h.strip()]

def get_commit_details(sha):
    """Get commit metadata and diff."""
    # Metadata
    meta = run(f'git show {sha} --format="%H%n%s%n%b%n%aI%n%P" --no-patch')
    lines = meta.strip().split('\n')

    commit_hash = lines[0] if len(lines) > 0 else sha
    subject = lines[1] if len(lines) > 1 else ""
    body_lines = lines[2:-2] if len(lines) > 4 else []
    body = '\n'.join(body_lines).strip()
    date = lines[-2] if len(lines) > 3 else ""
    parents = lines[-1].split() if len(lines) > 4 else []

    # Better parsing with explicit format
    meta2 = run(f'git log -1 {sha} --format="SUBJECT:%s%nDATE:%aI%nPARENTS:%P"')
    subject = ""
    date = ""
    parents = []
    for line in meta2.strip().split('\n'):
        if line.startswith("SUBJECT:"):
            subject = line[8:]
        elif line.startswith("DATE:"):
            date = line[5:]
        elif line.startswith("PARENTS:"):
            parents = line[8:].split()

    # Diff (stat + patch)
    diff_stat = run(f'git show {sha} --stat --format=""')
    diff_patch = run(f'git show {sha} --format="" --patch')

    # Files changed
    files = run(f'git show {sha} --format="" --name-only')
    file_list = [f.strip() for f in files.strip().split('\n') if f.strip()]

    return {
        "sha": sha,
        "subject": subject,
        "date": date,
        "parents": parents,
        "is_merge": len(parents) > 1,
        "files_changed": file_list,
        "diff_stat": diff_stat.strip(),
        "diff_patch": diff_patch.strip()
    }

def find_pr_for_commit(sha):
    """Try to find which PR a commit belongs to by checking merge commits."""
    # Check if this commit is referenced in a merge commit
    output = run(f'git log --all --merges --format="%H %s" --ancestry-path {sha}..HEAD 2>/dev/null | head -5')
    for line in output.strip().split('\n'):
        if 'Merge pull request #' in line:
            try:
                pr_num = int(line.split('#')[1].split()[0])
                return pr_num
            except (IndexError, ValueError):
                pass
    return None

def main():
    print("Fetching David's commits...")
    commits = get_david_commits()
    print(f"Found {len(commits)} commits")

    output_file = os.path.join(OUTPUT_DIR, "david_commits.jsonl")

    with open(output_file, 'w') as f:
        for i, sha in enumerate(commits):
            if (i + 1) % 50 == 0:
                print(f"  Processing {i+1}/{len(commits)}...")

            details = get_commit_details(sha)

            # Skip merge commits (they don't contain actual code)
            if details["is_merge"]:
                continue

            f.write(json.dumps(details) + '\n')

    # Count non-merge commits
    with open(output_file) as f:
        count = sum(1 for _ in f)

    print(f"Saved {count} non-merge commits to {output_file}")

if __name__ == "__main__":
    main()
