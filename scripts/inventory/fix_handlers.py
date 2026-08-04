#!/usr/bin/env python3
"""Re-derives handler names from the controllers and corrects table.json in place.

Kept as a separate step for now because removing it has not been established without a
differential run. It shares the decorator walk in tsparse.py with `make_table.py` rather than
carrying its own copy: the two used to run different `@Controller` parsers, and this one — the
weaker of the two, a regex that cannot cross a nested object — ran later and overwrote the
better result for the `controller` and `file` columns.

Idempotent: derives the handlers fresh from the source and merges them over (path, verb).
"""
import glob, os, json

from tsparse import (HTTP, block_and_handler, controller_scopes, full_path, read_text,
                     rel_path, scope_at)

SP = os.environ.get("INVENTORY_WORK")
if not SP:
    raise SystemExit("INVENTORY_WORK is not set - run this through scripts/inventory/run.sh")
SRC = os.environ.get("API_SRC")
if not SRC:
    raise SystemExit("API_SRC is not set - run this through scripts/inventory/run.sh")

fresh = {}
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.controller.ts'), recursive=True)):
    if '__tests__' in f: continue
    s = read_text(f)
    rel = rel_path(SRC, f)
    scopes = controller_scopes(s)
    if not scopes: continue
    for m in HTTP.finditer(s):
        base, cls = scope_at(scopes, m.start())
        _, handler = block_and_handler(s, m.end())
        fresh.setdefault((full_path(base, m.group(2) or ''), m.group(1).upper()), []).append(
            (cls, handler, rel))

unresolved = [(k, c, r) for k, v in fresh.items() for c, h, r in v if not h or not c]
print(f"routes: {sum(len(v) for v in fresh.values())} | without resolvable handler: {len(unresolved)}")
if unresolved:
    for k, c, r in unresolved:
        print(f"  UNRESOLVED {k[1]:6s} {k[0]:40s} {r}")
    raise SystemExit("the decorator walk lost its place - fix tsparse.py before continuing")

with open(SP + '/table.json') as fh:
    rows = json.load(fh)
used, changed = {}, 0
for r in rows:
    key = (r['path'], r['verb'])
    cand = fresh.get(key, [])
    n = used.get(key, 0)
    if n < len(cand):
        cls, h, rel = cand[n]; used[key] = n + 1
        if r['handler'] != h: r['handler'] = h; changed += 1
        r['controller'], r['file'] = cls, rel
print(f"handlers corrected in table.json: {changed}")
with open(SP + '/table.json', 'w') as fh:
    json.dump(rows, fh, indent=1)
