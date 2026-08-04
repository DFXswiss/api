#!/usr/bin/env python3
"""Extracts EVERY load site in the code. Locally decidable, no call-chain heuristics.

A load site is a call that reads data from the database. Per site this records: file, line,
enclosing class/method, target entity, loading mechanism. The column count is measured
afterwards by TypeORM itself (measure.js).
"""
import re, glob, os, json

import classify
from tsparse import read_text, rel_path

SP = os.environ.get("INVENTORY_WORK")
if not SP:
    raise SystemExit("INVENTORY_WORK is not set - run this through scripts/inventory/run.sh")
SRC = os.environ.get("API_SRC")
if not SRC:
    raise SystemExit("API_SRC is not set - run this through scripts/inventory/run.sh")

# Reading calls. save/update/delete are write paths and deliberately absent.
READ = re.compile(r'\.(find|findOne|findBy|findOneBy|findAndCount|findOneOrFail|'
                  r'findCached|findCachedBy|findOneCached|findOneCachedBy|'
                  r'createQueryBuilder|query)\s*\(')
CLASSRE = re.compile(r'export\s+(?:abstract\s+)?class\s+(\w+)')
SIG = re.compile(r'^\s{2,}(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(', re.M)


def parse_obj(text, i):
    res, i = {}, i + 1
    while i < len(text):
        c = text[i]
        if c == '}': return res, i + 1
        if c in ' \n\r\t,': i += 1; continue
        m = re.match(r'([A-Za-z_]\w*)\s*:\s*', text[i:])
        if not m: i += 1; continue
        key = m.group(1); i += m.end()
        if i < len(text) and text[i] == '{':
            sub, i = parse_obj(text, i); res[key] = sub if sub else True
        else:
            m2 = re.match(r'(true|false)', text[i:])
            if m2: res[key] = m2.group(1) == 'true'; i += m2.end()
            else:
                j = i
                while j < len(text) and text[j] not in ',}': j += 1
                i = j; res[key] = True
    return res, i


def norm(d):
    if d is True or not isinstance(d, dict): return True
    return {k: norm(v) for k, v in d.items() if v is not False} or True


ENTITIES = set()
for f in glob.glob(os.path.join(SRC, '**', '*.ts'), recursive=True):
    s = read_text(f)
    if '@Entity(' in s or '@ChildEntity(' in s:
        ENTITIES.update(m.group(1) for m in CLASSRE.finditer(s))
if not ENTITIES:
    raise SystemExit(f"no entities found under {SRC} - is API_SRC pointing at the source tree?")

sites = []
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.ts'), recursive=True)):
    if '__tests__' in f or '.spec.' in f: continue
    # Test infrastructure is not a load site of the application: it creates the schema and
    # builds fixtures, but never runs in the request path.
    if f.endswith('projection-test.util.ts'): continue
    raw = read_text(f)
    if not READ.search(raw): continue
    s = classify.strip_line_comments(raw)
    rel = rel_path(SRC, f)

    classes = [(m.start(), m.group(1)) for m in CLASSRE.finditer(s)]
    # Control structures look like method signatures - filter them out
    KW = {'if','for','while','switch','catch','return','do','else','try','constructor'}
    # All-caps identifiers are SQL keywords from template literals, not methods:
    # `CASE WHEN ... THEN (` matched the signature rule and entered the inventory as a
    # supposed method named `THEN`.
    methods = [(m.start(), m.group(1)) for m in SIG.finditer(s)
               if m.group(1) not in KW and not m.group(1).isupper()]
    def enclosing(pos, lst):
        cur = None
        for p, n in lst:
            if p < pos: cur = n
            else: break
        return cur

    # field -> type (file-wide; collisions are harmless here, this is a local attribution)
    inj = {}
    for mm in re.finditer(r'(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\s*:\s*(\w+)', s):
        inj[mm.group(1)] = mm.group(2)
    for mm in re.finditer(r'@InjectRepository\((\w+)\)\s*(?:private|public|protected)?\s*(?:readonly\s+)?(\w+)', s):
        inj[mm.group(2)] = mm.group(1) + 'Repository'

    for m in READ.finditer(s):
        call = m.group(1)
        pre = s[max(0, m.start() - 80):m.start()]
        cls = enclosing(m.start(), classes)
        meth = enclosing(m.start(), methods)
        line = s[:m.start()].count('\n') + 1

        # Resolve the target: this.<field>.<call>()  |  this.<call>()  |  <var>.<call>()
        entity, via = None, None
        tm = re.search(r'this\.(\w+)\s*$', pre)
        if tm:
            t = inj.get(tm.group(1), '')
            via = tm.group(1)
            if t.endswith('Repository') and t[:-10] in ENTITIES: entity = t[:-10]
            elif t in ENTITIES: entity = t
        elif re.search(r'this\s*$', pre) and cls and cls.endswith('Repository'):
            via, entity = 'this', cls[:-10] if cls[:-10] in ENTITIES else None
        else:
            vm = re.search(r'(\w+)\s*$', pre)
            if vm: via = vm.group(1)

        # Mechanism: eager or projected
        if call in ('createQueryBuilder', 'query'):
            kind = 'raw-sql' if call == 'query' else 'query-builder'
        else:
            kind = 'find'

        # relations tree, if written at the call site
        tree = None
        tail = s[m.end():m.end() + 4000]
        rm = re.search(r'relations\s*:\s*\{', tail)
        if rm and rm.start() < 600:
            try:
                t2, _ = parse_obj(tail, rm.end() - 1)
                if t2: tree = norm(t2)
            except Exception as exc:
                # An unreadable relations tree must not abort the scan - the load site still
                # counts, only without relation info. It is reported anyway, otherwise a
                # silently incomplete measurement would go unnoticed.
                print(f"WARN {rel}:{line} relations tree not readable: {exc}")

        # For a query builder: does an explicit field list follow? The same decision the
        # per-endpoint walk in endpoint_eff.py has to make, so it lives in classify.py.
        select = classify.select_kind(s, m.start(), m.end()) if call == 'createQueryBuilder' else None

        sites.append({'file': rel, 'line': line, 'cls': cls, 'method': meth,
                      'call': call, 'kind': kind, 'entity': entity, 'via': via,
                      'relations': tree, 'select': select})

if not sites:
    raise SystemExit(f"no load sites found under {SRC} - the scan produced nothing to measure")

with open(SP + '/sites.json', 'w') as fh:
    json.dump(sites, fh, indent=1)
from collections import Counter
print(f"load sites found: {len(sites)}")
print("  by mechanism:", dict(Counter(s['kind'] for s in sites)))
print(f"  with resolvable entity: {sum(1 for s in sites if s['entity'])}")
print(f"  of those with relations tree: {sum(1 for s in sites if s['relations'])}")
print(f"  files: {len({s['file'] for s in sites})}")
