#!/usr/bin/env python3
"""Per endpoint: does it reach a load site that loads more columns than it needs?

Unlike the withdrawn attempt, this claims NO single "load path"
This claims no single "load path" per endpoint. What is formed is the UNION over every load
site reachable from the handler — the aggregation that matches the question: as soon as any
one of them overloads, the endpoint loads more than it needs.

Categories per load site (verified against the TypeORM metadata):
  find*(...)                                -> every column plus eager relations -> over
  createQueryBuilder() without .select([...]) -> every column of the root entity -> over
  createQueryBuilder().select([...])        -> only the listed fields             -> proj
  .query(...)  raw SQL                             -> depends on the statement       -> raw
"""
import re, glob, os, json
from collections import defaultdict

SP = os.environ['GEN_SP']
SRC = os.environ['API_SRC']

FIND = re.compile(r'\.(find|findOne|findBy|findOneBy|findAndCount|findOneOrFail|'
                  r'findCached|findCachedBy|findOneCached|findOneCachedBy)\s*\(')
QB = re.compile(r'\.createQueryBuilder\s*\(')
RAW = re.compile(r'\.query\s*\(')
SIG = re.compile(r'^\s{2,}(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(', re.M)
SKIP = {'constructor', 'if', 'for', 'while', 'switch', 'catch', 'return', 'do', 'else', 'try'}
# Calls through `this`. Dots may be surrounded by line breaks — the fluent
# style `this.service\n  .method(...)` is the rule in this repository, not the exception.
CALL = re.compile(r'this\s*\.\s*((?:\w+\s*\.\s*)*\w+)\s*\(')

def brace(s, i):
    d = 0
    for j in range(i, len(s)):
        if s[j] == '{': d += 1
        elif s[j] == '}':
            d -= 1
            if d == 0: return s[i + 1:j], j
    return s[i + 1:], len(s)

def body_start(s, i):
    """First '{' AFTER the return-type annotation, from position i (past the parameter list).

    `Promise<{ data: X; capReached: boolean }>` contains a brace that looks like the start of a
    method body. The rule is exact rather than heuristic: if the candidate closes a bracket
    bracket group and another '{' follows immediately, the first one was the type annotation.
    A real body is never followed immediately by an opening brace.
    """
    lt, j = 0, i
    while j < len(s):
        c = s[j]
        if c == '<': lt += 1
        elif c == '>':
            if lt: lt -= 1                     # do not count '=>' in function types as a closer
        elif c == ';' and lt == 0:
            return -1                      # an abstract declaration, no body
        elif c == '{':
            _, close = brace(s, j)
            if lt > 0:                     # a bracket inside '<...>' belongs to a type
                j = close + 1; continue
            nxt = close + 1
            while nxt < len(s) and s[nxt] in ' \n\r\t': nxt += 1
            if nxt < len(s) and s[nxt] == '{':  # a bare object return type
                j = nxt; continue
            return j
        j += 1
    return -1

# Inherited write and count operations: no eager, and not findable on the concrete class.
NO_LOAD = {'save', 'update', 'create', 'delete', 'remove', 'insert', 'upsert', 'increment',
           'decrement', 'count', 'countBy', 'exists', 'existsBy', 'invalidateCache', 'clear',
           'softDelete', 'restore', 'preload', 'merge', 'getRepository', 'manager'}
# Verified: no entity access.
EXTERNAL = {'Map', 'Set', 'Date', 'Array', 'Promise', 'JSON', 'Object', 'Queue', 'Subject',
            'Observable', 'QueueItem', 'QueueHandler', 'StorageService', 'RegisterStrategyRegistry',
            'Logger', 'EventEmitter2', 'HttpService', 'ConfigService', 'SchedulerRegistry',
            'I18nService', 'JwtService', 'Cron', 'Lock', 'ProcessService'}

ARROW = re.compile(r'\s*(?:\([^()]*\)|\w+)\s*=>')
REPOISH = re.compile(r'repo|repository', re.I)

def is_db_find(body, fm, cls):
    """Tells `repo.find({...})` apart from `array.find(x => ...)`.

    Arrays carry `find` too — without this distinction every search in a list would count as a
    database read. `findOne`/`findBy`/`findAndCount` do not exist on arrays and are unambiguous;
    only `find` itself needs the check.
    """
    if fm.group(1) != 'find': return True
    if ARROW.match(body, fm.end()): return False          # a callback, not a search condition
    pre = body[max(0, fm.start() - 90):fm.start()]
    if re.search(r'getRepository\s*\([^)]*\)\s*$', pre): return True
    tm = re.search(r'this\s*\.\s*(\w+)\s*$', pre)
    if tm:
        t = INJECT.get(cls, {}).get(tm.group(1), '')
        return bool(REPOISH.search(tm.group(1)) or REPOISH.search(t or ''))
    if re.search(r'this\s*$', pre): return cls.endswith('Repository')
    vm = re.search(r'(\w+)\s*$', pre)
    return bool(vm and REPOISH.search(vm.group(1)))

def is_projection(chain, body=''):
    """Does the chain name columns, or does it just pass the alias through?

    `.select(['a.x','a.y'])` and `.select('a.x')` name columns — both project.
    `.select('buyCrypto')` passes the root alias: it reads like a projection,
    but loads every column. The dot in the first argument is what separates them.
    """
    joined = re.search(r'(?:left|inner)JoinAndSelect\s*\(', chain)
    # `.select(bucketExpr, 'bucket')` — the argument sits in a variable. The one in the body
    # assigned in the body decides: a bare identifier would be the root alias, anything
    # the other names something. Without resolving this, a projected aggregate query would count
    # as "loads whole rows".
    v = re.search(r"\.select\(\s*([A-Za-z_$][\w$]*)\s*[,)]", chain)
    if v:
        a = re.search(r"\b(?:const|let|var)\s+" + re.escape(v.group(1)) + r"\s*=\s*([^;\n]+)", body)
        if not a: return False
        return not re.fullmatch(r"['\"`]\w+['\"`]", a.group(1).strip()) and not joined
    m = re.search(r"\.select\(\s*(\[|['\"`])", chain)
    if not m: return False
    if m.group(1) == '[': return not re.search(r'(?:left|inner)JoinAndSelect\s*\(', chain)
    a = re.search(r"\.select\(\s*['\"`]([^'\"`]*)['\"`]", chain)
    # Only a bare identifier is the root alias; a column or an expression narrows the query.
    if not a or re.fullmatch(r'\w+', a.group(1).strip()): return False
    # `leftJoinAndSelect` fetches the joined entity whole — the projection on the root then
    # no longer helps.
    return not re.search(r'(?:left|inner)JoinAndSelect\s*\(', chain)

SITES_OF = {}                    # (cls, meth) -> {(datei, zeile)}
METHODS = defaultdict(dict)      # cls -> meth -> list[body]
INJECT = defaultdict(dict)       # cls -> field -> type
DIRECT = defaultdict(dict)       # cls -> meth -> set(kategorien)

for f in sorted(glob.glob(os.path.join(SRC, '**', '*.ts'), recursive=True)):
    if '__tests__' in f or '.spec.' in f: continue
    s = open(f, encoding='utf-8', errors='replace').read()
    s = re.sub(r'(?m)(?<!:)//[^\n]*', '', s)          # line comments only, protecting URLs
    rel = f.replace(SRC + '/', 'src/')
    classes = [(m.start(), m.group(1)) for m in
               re.finditer(r'export\s+(?:abstract\s+)?class\s+(\w+)', s)]
    if not classes: continue

    def owner(pos):
        cur = None
        for cpos, cname in classes:
            if cpos < pos: cur = cname
            else: break
        return cur

    for mm in re.finditer(r'(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\s*:\s*(\w+)', s):
        c = owner(mm.start())
        if c: INJECT[c][mm.group(1)] = mm.group(2)
    for mm in re.finditer(r'@InjectRepository\((\w+)\)\s*(?:private|public|protected)?\s*'
                          r'(?:readonly\s+)?(\w+)', s):
        c = owner(mm.start())
        if c: INJECT[c][mm.group(2)] = mm.group(1) + 'Repository'

    for sm in SIG.finditer(s):
        name = sm.group(1)
        if name in SKIP: continue
        cls = owner(sm.start())
        if not cls: continue
        # Skip the parameter list (destructured parameters would otherwise read as the body)
        dp, i = 1, sm.end()
        while i < len(s) and dp:
            if s[i] == '(': dp += 1
            elif s[i] == ')': dp -= 1
            i += 1
        ob = body_start(s, i)
        if ob < 0: continue
        mb, _ = brace(s, ob)
        METHODS[cls].setdefault(name, []).append(mb)   # Namenskollisionen: vereinigen

        kinds = DIRECT[cls].setdefault(name, set())
        sites = SITES_OF.setdefault((cls, name), set())
        def at(off):                                   # line number of the load site
            return rel, s[:ob + 1 + off].count('\n') + 1
        for fm in FIND.finditer(mb):
            if is_db_find(mb, fm, cls):
                kinds.add('over'); sites.add(at(fm.start()))
        for qm in QB.finditer(mb):
            chain = mb[qm.end():qm.end() + 1500].split(';')[0]
            # `PROJECTION.apply(this.createQueryBuilder('x'), fields)` — the field list lives in
            # the projection constant, not in the chain. Without this case every load going
            # built through ReadProjection would count as "loads whole rows".
            before = mb[max(0, qm.start() - 160):qm.start()]
            if re.search(r'\b[A-Z][A-Z0-9_]*\s*\.\s*apply\s*\(\s*(?:this|[A-Za-z_$][\w$]*)(?:\s*\.\s*[\w$]+)*$', before):
                kinds.add('proj'); sites.add(at(qm.start())); continue
            # `.update()/.delete()/.insert()` are write statements — they load nothing.
            if re.search(r'\.(update|delete|insert|softDelete|restore)\s*\(', chain): continue
            # `getCount()` and `getExists()` discard the select list and issue COUNT(...)
            # or SELECT 1 — such a chain materialises no row, whatever precedes it.
            if re.search(r'\.(getCount|getExists)\s*\(\s*\)', chain):
                kinds.add('proj'); sites.add(at(qm.start())); continue
            kinds.add('proj' if is_projection(chain, mb) else 'over')
            sites.add(at(qm.start()))
        for rm in RAW.finditer(mb):
            pre = mb[max(0, rm.start() - 60):rm.start()]
            if re.search(r'this\.(\w+)\s*$', pre) or re.search(r'this\s*$', pre):
                kinds.add('raw')

# ---- build the call graph (edges once, then a fixpoint rather than recursion) ----
# The fixpoint handles cycles exactly: a recursion with cycle-breaking returns different results
# depending on the entry point, and caches them on top of that.
EDGES = defaultdict(set)
LOCAL_OK = {}
for cls in METHODS:
    for meth, bodies in METHODS[cls].items():
        key = (cls, meth)
        ok = True
        for body in bodies:
            # locally constructed objects: `const txLogRepo = new LogRepository(manager)` and
            # then `txLogRepo.getFoo(...)` — without this kind of edge a load stays
            # transaction that constructs its own repository invisible.
            local = {m.group(1): m.group(2)
                     for m in re.finditer(r'\b(?:const|let|var)\s+(\w+)\s*=\s*new\s+(\w+)\s*\(', body)}
            for lm in re.finditer(r'\b(\w+)\s*\.\s*(\w+)\s*\(', body):
                t = local.get(lm.group(1))
                if t and lm.group(2) in METHODS.get(t, {}):
                    EDGES[key].add((t, lm.group(2)))
            for cm in CALL.finditer(body):
                parts = [p.strip() for p in cm.group(1).split('.')]
                called, fields = parts[-1], parts[:-1]
                sub_cls, external = cls, False
                for fld in fields:
                    t = INJECT.get(sub_cls, {}).get(fld)
                    if t in EXTERNAL: external = True; break
                    if t is None:
                        ok = False              # Feldtyp unbekannt: ehrlicher Zweifelsfall
                        external = True; break
                    sub_cls = t
                if external or sub_cls in EXTERNAL: continue
                if called not in METHODS.get(sub_cls, {}):
                    # without a body: an inherited write or count operation loads nothing,
                    # anything else is a genuine doubtful case
                    if called not in NO_LOAD: ok = False
                    continue
                EDGES[key].add((sub_cls, called))
        LOCAL_OK[key] = ok

# Measured column count per load site (from the TypeORM measurement), matched on file+line
MEAS = {(s['file'], s['line']): s.get('cols')
        for s in json.load(open(SP + '/sites-measured.json')) if s.get('cols')}

KINDS = {k: set(DIRECT[k[0]].get(k[1], set())) for k in LOCAL_OK}
OK = dict(LOCAL_OK)
MAXCOL = {k: max([MEAS.get(x, 0) for x in SITES_OF.get(k, ())] or [0]) for k in LOCAL_OK}
REACH = {k: set(SITES_OF.get(k, ())) for k in LOCAL_OK}
changed = True
while changed:
    changed = False
    for n, targets in EDGES.items():
        for t in targets:
            if not KINDS[t] <= KINDS[n]:
                KINDS[n] |= KINDS[t]; changed = True
            if OK[n] and not OK[t]:
                OK[n] = False; changed = True
            if MAXCOL[t] > MAXCOL[n]:
                MAXCOL[n] = MAXCOL[t]; changed = True
            if not REACH.get(t, set()) <= REACH.setdefault(n, set()):
                REACH[n] |= REACH[t]; changed = True

def reach(cls, meth):
    key = (cls, meth)
    if key not in KINDS: return set(), False
    return KINDS[key], OK[key]

# ---- Resolved by hand: dynamic targets the graph does not reach ----
# Every entry was read in the source; the reason follows it. None of them reads from the
# database in the request path. render-docs.py prints the same reasons.
MANUAL_NO_DB = {
    ('AlchemyController', 'addressWebhook'):             'HMAC check against a key held in memory',
    ('AlchemyController', 'addresses'):                  'third-party SDK (`alchemy.notify`), no table of ours',
    ('AuthController', 'signInWithAlby'):                'builds an OAuth URL; the pending state lives in memory',
    ('YapealWebhookController', 'handleYapealWebhook'):  'hands off through an rxjs subject — the loading happens in the subscriber, not in the request path',
    ('DexController', 'checkLiquidity'):                 'strategy registry; no strategy under `dex/strategies/{check,purchase,sell}-liquidity` contains a load site',
    ('DexController', 'purchaseLiquidity'):              'same registry as `GET /dex/check-liquidity`',
    ('DexController', 'reserveLiquidity'):               'same registry as `GET /dex/check-liquidity`',
    ('DexController', 'checkTransferCompletion'):        'same registry as `GET /dex/check-liquidity`',
    ('DexController', 'transferLiquidity'):              'same registry as `GET /dex/check-liquidity`',
    ('ExchangeController', 'getBalance'):                'callback onto an exchange client, no entity involved',
    ('ExchangeController', 'getPrice'):                  'same callback as `GET /exchange/:exchange/balances`',
    ('ExchangeController', 'getTrades'):                 'same callback as `GET /exchange/:exchange/balances`',
    ('ExchangeController', 'trade'):                     'same callback as `GET /exchange/:exchange/balances`',
    ('ExchangeController', 'getTradeHistory'):           'same callback as `GET /exchange/:exchange/balances`',
    ('ExchangeController', 'withdrawFunds'):             'same callback as `GET /exchange/:exchange/balances`',
    ('ExchangeController', 'getWithdraw'):               'same callback as `GET /exchange/:exchange/balances`',
    ('C2BPaymentLinkController', 'kucoinPayWebhook'):    'signature check; the services it reaches contain no load site',
    ('PayoutController', 'doPayout'):                    'a factory builds the entity, then `save()` — a pure write path',
    ('RealUnitController', 'getBrokerbotBuyPrice'):      'price from an in-memory cache, otherwise from the chain',
    ('RealUnitController', 'getBrokerbotBuyShares'):     'same cache as `GET /realunit/brokerbot/buyPrice`',
    ('RealUnitController', 'getBrokerbotPrice'):         'same cache as `GET /realunit/brokerbot/buyPrice`',
    ('RealUnitController', 'getQuoteBuyPrice'):          'same cache as `GET /realunit/brokerbot/buyPrice`',
    ('RealUnitController', 'getQuoteBuyShares'):         'same cache as `GET /realunit/brokerbot/buyPrice`',
    ('RealUnitController', 'getQuotePrice'):             'same cache as `GET /realunit/brokerbot/buyPrice`',
    ('TatumController', 'addressWebhook'):               'signature check, then a third-party SDK',
    ('AppController', 'getVersion'):                     'reads `dist/version.txt` from disk',
}

eps = json.load(open(SP + '/table.json'))
out = []
for r in eps:
    k, ok = reach(r['controller'], r['handler'])
    key = (r['controller'], r['handler'])
    manual = None
    if not k and not ok and key in MANUAL_NO_DB:
        ok, manual = True, MANUAL_NO_DB[key]
    out.append({**r, 'kinds': sorted(k), 'complete': ok, 'manual': manual,
                'maxcol': MAXCOL.get((r['controller'], r['handler']), 0),
                'sites': sorted(f'{f}:{l}' for f, l in REACH.get(key, set()))})
# Does any spec touch this endpoint at all? Strict: the same file names the controller
# AND calls the handler. A weak signal and a lower bound — specs driving a route over HTTP
# a route over HTTP without naming the handler are missed.
SPECS = [open(f, encoding='utf-8', errors='replace').read()
         for f in glob.glob(os.path.join(SRC, '**', '*.spec.ts'), recursive=True)]
for r in out:
    pat = re.compile(r'\b' + re.escape(r['handler']) + r'\s*\(')
    r['spec'] = any(r['controller'] in txt and pat.search(txt) for txt in SPECS)

json.dump(out, open(SP + '/endpoint-eff.json', 'w'), indent=1)

from collections import Counter
# Caller-defined projection: `request.select(query.select)` — projects only when the
# caller sends a field list; without one, every column of the table is loaded.
CALLER_SELECT = {'/gs/db', '/gs/db/custom'}

def cat(e):
    if e['path'] in CALLER_SELECT: return 'caller-defined'
    k = set(e['kinds'])
    if 'over' in k: return 'loads whole rows'
    if not k: return 'no database access'
    if k <= {'proj', 'raw'}: return 'projects'
    return 'unclear'

c = Counter(cat(e) for e in out)
print(f"endpoints: {len(out)}")
for k in ['loads whole rows', 'no database access', 'projects', 'caller-defined', 'unclear']:
    if c[k]: print(f"  {k:20s} {c[k]:4d}  ({100*c[k]/len(out):.0f} %)")

ineff = [e for e in out if cat(e) == 'loads whole rows']
mc = sorted((e['maxcol'] for e in ineff if e['maxcol']), reverse=True)
print(f"\nWidest query triggered (measured columns), {len(mc)} of {len(ineff)} measurable:")
print(f"  over 1000 columns: {sum(1 for x in mc if x > 1000)}")
print(f"  over  500 columns: {sum(1 for x in mc if x > 500)}")
print(f"  over  100 columns: {sum(1 for x in mc if x > 100)}")
print(f"  Median: {mc[len(mc)//2]}")
print("\nSpitzenreiter:")
for e in sorted(ineff, key=lambda x: -x['maxcol'])[:8]:
    print(f"  {e['maxcol']:5d}  {e['verb']:6s} {e['path']}")
print("\nEffizient:")
for e in out:
    if cat(e) in ('projects', 'caller-defined'):
        print(f"  {cat(e):20s} {e['verb']:6s} {e['path']:34s} {e['kinds']}")
