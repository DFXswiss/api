#!/usr/bin/env python3
"""Compares the routes in table.json against the routes the running application registers.

Standalone, not part of `run.sh`. Reads `$INVENTORY_WORK/prod-norm.txt`, which must contain
lines of the form `<METHOD> <path>` taken from the application's `Mapped {...}` startup logs.

This reads `table.json` rather than parsing the controllers again. The predecessor of this
script carried its own copy of the route scan, with a handler detection bug and an
`@ApiExcludeEndpoint` window that looked backwards into the *previous* handler's decorators. A
verifier that re-derives what it verifies with weaker rules cannot confirm anything.
"""
import json, os, sys

SP = os.environ.get("INVENTORY_WORK")
if not SP:
    raise SystemExit("INVENTORY_WORK is not set - run the pipeline through scripts/inventory/run.sh first")

table = SP + '/table.json'
if not os.path.exists(table):
    raise SystemExit(f"{table} is missing - run scripts/inventory/run.sh first")
with open(table) as fh:
    rows = json.load(fh)

mine = {(r['verb'], r['path']) for r in rows}
print(f"routes from the code:            {len(rows)} ({len(mine)} distinct verb/path pairs)")

p = SP + '/prod-norm.txt'
if not os.path.exists(p):
    print(f"no reference at {p} - nothing to compare against")
    sys.exit(0)

ref = set()
with open(p) as fh:
    for line in fh:
        parts = line.strip().split(' ', 1)
        if len(parts) == 2: ref.add((parts[0].upper(), parts[1]))
if not ref:
    raise SystemExit(f"{p} contains no `<METHOD> <path>` lines")

only_code, only_ref = sorted(mine - ref), sorted(ref - mine)
print(f"reference (registered routes):   {len(ref)}")
print(f"  code only:      {len(only_code)}  {only_code[:6]}")
print(f"  reference only: {len(only_ref)}  {only_ref[:6]}")
print(f"  coverage:       {100*len(mine & ref)/len(ref):.1f} %")
sys.exit(1 if only_code or only_ref else 0)
