#!/usr/bin/env python3
"""Builds table.json fresh from the controllers (verb, path, controller, handler, file, internal).

Decorators between the route decorator and the method are skipped by counting brackets (strings
and comments respected), otherwise a multi-line `@UseGuards(` has its guard read as the handler.
The parsing itself lives in tsparse.py and is shared with the other controller readers.
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

rows = []
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.controller.ts'), recursive=True)):
    if '__tests__' in f: continue
    s = read_text(f)
    rel = rel_path(SRC, f)
    scopes = controller_scopes(s)
    if not scopes: continue
    for m in HTTP.finditer(s):
        base, cls = scope_at(scopes, m.start())
        block, handler = block_and_handler(s, m.end())
        rows.append({'verb': m.group(1).upper(), 'path': full_path(base, m.group(2) or ''),
                     'controller': cls, 'handler': handler, 'file': rel,
                     'internal': '@ApiExcludeEndpoint' in block})

if not rows:
    raise SystemExit(f"no routes found under {SRC} - is API_SRC pointing at the source tree?")

# An unresolved handler or controller means the decorator walk lost its place. That is a defect
# in this script, not a property of the source, so it is named loudly instead of travelling on
# as a placeholder that later stages would silently fail to join against.
broken = [r for r in rows if not r['handler'] or not r['controller']]
if broken:
    for r in broken:
        print(f"  UNRESOLVED {r['verb']:6s} {r['path']:40s} {r['file']}")
    raise SystemExit(f"{len(broken)} of {len(rows)} routes have no resolvable handler or "
                     "controller - fix the decorator parsing in tsparse.py before continuing")

rows.sort(key=lambda r: (r['path'], r['verb']))
with open(SP + '/table.json', 'w') as fh:
    json.dump(rows, fh, indent=1)
print('routes:', len(rows), '| internal:', sum(1 for r in rows if r['internal']))
