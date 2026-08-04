#!/usr/bin/env python3
"""Applies the drift caused by develop to a PUBLISHED load-sites.md.

Why not regenerate: the published documents were generated once and then corrected by hand over
several review rounds (median figures, the upper-bound caveat, English labels, the target
sentence). The renderer knows none of that, so a fresh run would discard it.

What is transferred is therefore only what comparing TWO runs of the SAME chain yields:
  - load sites that are new        -> insert a row, with its measured width
  - load sites that are gone       -> remove the row
  - load sites whose line moved    -> update the reference

The column count of existing rows stays as published: it comes from the rule set of this PR,
and the measurement has not changed for them.

This rewrites the table only. The counts in the surrounding prose ("N load sites across M
files", the median figures under *Measurements*) are NOT updated - the statistics printed at
the end and written to <out>.stats.json are what you carry over by hand.
"""
import json, os, re, statistics, subprocess, sys
from collections import defaultdict

import classify

S = os.environ.get("INVENTORY_WORK")
if not S:
    raise SystemExit("INVENTORY_WORK is not set - see scripts/inventory/README.md")
REPO = os.environ.get("INVENTORY_REPO")
if not REPO:
    raise SystemExit("INVENTORY_REPO is not set - see scripts/inventory/README.md")
SRC = os.environ.get("API_SRC")
if not SRC:
    raise SystemExit("API_SRC is not set - see scripts/inventory/README.md")

KEY = lambda s: (s['file'], s['cls'], s['method'], s['call'], s['entity'])
CELL = lambda r, i: r.split('|')[i].strip().strip('`')


def rows_of(text):
    return [l for l in text.split('\n')
            if l.startswith('|') and len(l.split('|')) == 8 and not re.match(r'^\|[\s:|-]+\|$', l)]


def render(s):
    """One row in the format of the published table."""
    cols = s.get('cols')
    c = '—' if cols is None else str(cols)
    j = '—' if cols is None else str(s.get('joins') or 0)
    mech = s['kind'] + (f" ({s['select']})" if s.get('select') else '')
    ent = s.get('entity') or '—'
    return f"| {c} | {j} | {mech} | `{ent}` | `{s['file'].removeprefix('src/')}:{s['line']}` | `{s['cls']}.{s['method']}` |"


def load_run(which):
    path = f"{S}/gen/{which}/sites-measured.json"
    if not os.path.exists(path):
        raise SystemExit(f"{path} is missing - run the inventory chain for the '{which}' state "
                         "first, see scripts/inventory/README.md")
    with open(path) as fh:
        sites = json.load(fh)
    if not sites:
        raise SystemExit(f"{path} is empty - the '{which}' run produced no load sites")
    return sites


def main(pub_ref, pub_path, out_path):
    show = subprocess.run(["git", "-C", REPO, "show", f"{pub_ref}:{pub_path}"],
                          capture_output=True, text=True)
    if show.returncode != 0:
        raise SystemExit(f"git show {pub_ref}:{pub_path} failed in {REPO}: "
                         f"{show.stderr.strip() or 'unknown error'}")
    pub = show.stdout

    old = load_run('old')
    # The write/lock rule must be the same one the renderer applies, and it is derived from the
    # source rather than stored in sites-measured.json - annotating here is what makes the
    # filter below actually match. Without it, `.update()` chains, advisory locks and raw
    # INSERTs would be inserted into the document as load sites.
    new = classify.annotate(SRC, load_run('new'))

    by_line = {(s['file'], s['line']): s for s in old}
    old_pool = defaultdict(list)
    for s in old:
        old_pool[KEY(s)].append(s)
    new_pool = defaultdict(list)
    for s in new:
        new_pool[KEY(s)].append(s)

    body = rows_of(pub)
    if len(body) < 2:
        raise SystemExit(f"{pub_ref}:{pub_path} contains no load-site table - is the path right?")
    header, data = body[0], body[1:]

    kept, dropped, moved = [], 0, 0
    used = defaultdict(int)
    for r in data:
        f, ln = CELL(r, 5).rsplit(':', 1)
        o = by_line.get(('src/' + f, int(ln)))
        if o is None:                      # not found in the old run: carry over unchanged
            kept.append(r)
            continue
        k = KEY(o)
        pool = new_pool.get(k, [])
        idx = used[k]
        if idx >= len(pool):               # no longer exists on develop
            dropped += 1
            continue
        used[k] += 1
        nline = pool[idx]['line']
        if nline != o['line']:
            r = r.replace(f"`{f}:{ln}`", f"`{f}:{nline}`")
            moved += 1
        kept.append(r)

    # New load sites: everything in the new run the matching above did not consume. Write
    # statements and locks do not belong in the table - the same rule as in the renderer.
    added = []
    for k, pool in new_pool.items():
        for s in pool[used.get(k, 0):]:
            if not s.get('write'):
                added.append(s)

    rows = kept + [render(s) for s in added]
    width = lambda r: (lambda c: int(c) if re.fullmatch(r'\d+', c) else -1)(CELL(r, 1))
    rows.sort(key=lambda r: -width(r))

    nums = sorted(width(r) for r in rows if width(r) >= 0)
    if not nums:
        raise SystemExit("no row carries a measured width - refusing to write a document whose "
                         "statistics would all be zero")
    stats = dict(rows=len(rows), measured=len(nums), median=statistics.median(nums),
                 maxwidth=max(nums), over1000=sum(1 for v in nums if v > 1000),
                 over500=sum(1 for v in nums if v > 500), over100=sum(1 for v in nums if v > 100))
    print(f"  kept={len(kept)}  removed={dropped}  line reference updated={moved}  new={len(added)}")
    print(f"  result: {json.dumps(stats, default=str)}")
    print("  the prose counts in the document are NOT updated - carry the figures above over by hand")

    out = pub.split('\n')
    first = out.index(header)
    last = max(i for i, l in enumerate(out) if l.startswith('|') and len(l.split('|')) == 8)
    out = out[:first + 2] + rows + out[last + 1:]
    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(out))
    with open(out_path + '.stats.json', 'w') as fh:
        json.dump(stats, fh, default=str)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit("usage: apply_drift.py <pub_ref> <pub_path> <out_path>\n"
                         "  see scripts/inventory/README.md for the required environment")
    main(*sys.argv[1:])
