#!/usr/bin/env python3
"""Adds `deprecated` to table.json and derives `version` from the full decorator block.

The block between the route decorator and the method is delimited exactly (counting brackets,
respecting strings and comments) - a window over a fixed number of lines misses a multi-line
`@ApiOperation({ ... deprecated: true })`. The parsing is shared through tsparse.py.
"""
import re, glob, os, json

from tsparse import (HTTP, controller_arg, controller_scopes, decorator_block, full_path,
                     read_text, skip_args)

SP = os.environ.get("INVENTORY_WORK")
if not SP:
    raise SystemExit("INVENTORY_WORK is not set - run this through scripts/inventory/run.sh")
SRC = os.environ.get("API_SRC")
if not SRC:
    raise SystemExit("API_SRC is not set - run this through scripts/inventory/run.sh")

DEFAULT_VERSION = '1'
# `@Controller({ version: [GetConfig().kycVersion] })` names the version through the config
# rather than as a literal. The mapping is resolved here because the config is not loaded;
# if the configured value ever changes, this line has to follow it.
NAMED = {'GetConfig().kycVersion': '2'}

CTRL_START = re.compile(r'@Controller\s*\(')


def scope_version(arg):
    if not arg or not arg.startswith('{'): return DEFAULT_VERSION
    m = re.search(r'version\s*:\s*\[([^\]]*)\]', arg)
    if not m: return DEFAULT_VERSION
    raw = m.group(1).strip().strip('\'"')
    return NAMED.get(raw, raw)


flags = {}
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.controller.ts'), recursive=True)):
    if '__tests__' in f: continue
    s = read_text(f)
    scopes = controller_scopes(s)
    if not scopes: continue
    # The version rides on the same scope boundaries as the path, but needs the raw argument
    # text, which controller_scopes() does not keep.
    versions = [(m.start(), scope_version(controller_arg(s, m.end() - 1)))
                for m in CTRL_START.finditer(s)]
    for m in HTTP.finditer(s):
        base, _ = '', None
        ver = DEFAULT_VERSION
        for pos, b, _c in scopes:
            if pos < m.start(): base = b
            else: break
        for pos, v in versions:
            if pos < m.start(): ver = v
            else: break
        block, _ = decorator_block(s, m.end())
        vm = re.search(r'@Version\(\s*([^)]*)\s*\)', block)
        if vm:
            a = vm.group(1).strip()
            ver = 'neutral' if 'NEUTRAL' in a else a.strip('[]\'" ')
        dep = bool(re.search(r'deprecated\s*:\s*true', block))
        flags.setdefault((m.group(1).upper(), full_path(base, m.group(2) or '')), []).append((ver, dep))

with open(SP + '/table.json') as fh:
    rows = json.load(fh)

# A route present in table.json but absent from `flags` would silently receive the default
# version and `deprecated = False`. Both scans read the same controllers with the same parser,
# so a miss means they disagree - which is a defect, not a row to fill in with a guess.
used, missing = {}, []
for r in rows:
    key = (r['verb'], r['path'])
    n = used.get(key, 0); used[key] = n + 1
    lst = flags.get(key, [])
    if n >= len(lst):
        missing.append(r)
        r['version'], r['deprecated'] = DEFAULT_VERSION, False
        continue
    r['version'], r['deprecated'] = lst[n]
if missing:
    for r in missing:
        print(f"  NO DECORATOR MATCH {r['verb']:6s} {r['path']:40s} {r['file']}")
    raise SystemExit(f"{len(missing)} of {len(rows)} routes have no decorator match - the route "
                     "scan and the version scan disagree, fix them before continuing")

with open(SP + '/table.json', 'w') as fh:
    json.dump(rows, fh, indent=1)

from collections import Counter
print('versions:', dict(Counter(r['version'] for r in rows)))
print('deprecated:', sum(1 for r in rows if r['deprecated']))
for r in rows:
    if r['deprecated']: print(f"   v{r['version']} {r['verb']:6s} {r['path']:34s} {r['controller']}.{r['handler']}")
