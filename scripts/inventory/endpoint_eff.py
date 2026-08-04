#!/usr/bin/env python3
"""Je Endpunkt: erreicht er eine Ladestelle, die mehr Spalten laedt als noetig?

Anders als der zurueckgezogene Versuch behauptet das hier KEINEN einzelnen "Ladeweg"
pro Endpunkt. Gebildet wird die VEREINIGUNG ueber alle vom Handler aus erreichbaren
Ladestellen - genau die Aggregation, die zur Frage passt: sobald irgendeine davon
ueberlaedt, laedt der Endpunkt mehr als noetig.

Kategorien je Ladestelle (an den TypeORM-Metadaten verifiziert):
  find*(...)                                -> alle Spalten + eager-Relationen  -> over
  createQueryBuilder() ohne .select([...])  -> alle Spalten der Wurzel-Entity   -> over
  createQueryBuilder().select([...])        -> nur die gelisteten Felder        -> proj
  .query(...)  rohes SQL                    -> haengt vom Statement ab          -> raw
"""
import re, glob, os, json
from collections import defaultdict

def read_text(path):
    """Datei vollständig einlesen und das Handle sofort wieder schliessen."""
    with open(path, encoding='utf-8', errors='replace') as fh:
        return fh.read()

SP = os.environ.get("INVENTORY_WORK")
if not SP:
    raise SystemExit("INVENTORY_WORK is not set - run this through scripts/inventory/run.sh")
SRC = os.environ.get("API_SRC")
if not SRC:
    raise SystemExit("API_SRC is not set - run this through scripts/inventory/run.sh")

FIND = re.compile(r'\.(find|findOne|findBy|findOneBy|findAndCount|findOneOrFail|'
                  r'findCached|findCachedBy|findOneCached|findOneCachedBy)\s*\(')
QB = re.compile(r'\.createQueryBuilder\s*\(')
RAW = re.compile(r'\.query\s*\(')
SIG = re.compile(r'^\s{2,}(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(', re.M)
SKIP = {'constructor', 'if', 'for', 'while', 'switch', 'catch', 'return', 'do', 'else', 'try'}
# Aufrufe ueber `this`. Punkte duerfen von Zeilenumbruechen umgeben sein - der fluente
# Stil `this.service\n  .methode(...)` ist im Repo die Regel, nicht die Ausnahme.
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
    """Erste '{' NACH der Rueckgabetyp-Annotation, ab Position i (hinter der Parameterliste).

    `Promise<{ data: X; capReached: boolean }>` enthaelt eine Klammer, die wie ein
    Methodenrumpf aussieht. Erkennungsregel, exakt statt heuristisch: schliesst eine
    Klammergruppe und folgt darauf sofort wieder '{', war die erste die Typ-Annotation.
    Nach einem echten Rumpf folgt nie unmittelbar eine oeffnende Klammer.
    """
    lt, j = 0, i
    while j < len(s):
        c = s[j]
        if c == '<': lt += 1
        elif c == '>':
            if lt: lt -= 1                     # '=>' in Funktionstypen nicht negativ zaehlen
        elif c == ';' and lt == 0:
            return -1                          # abstrakte Deklaration, kein Rumpf
        elif c == '{':
            _, close = brace(s, j)
            if lt > 0:                         # Klammer innerhalb von '<...>' = Typ
                j = close + 1; continue
            nxt = close + 1
            while nxt < len(s) and s[nxt] in ' \n\r\t': nxt += 1
            if nxt < len(s) and s[nxt] == '{':  # blosser Objekt-Rueckgabetyp
                j = nxt; continue
            return j
        j += 1
    return -1

# Geerbte Schreib-/Zaehloperationen: kein eager, und in der konkreten Klasse nicht auffindbar.
NO_LOAD = {'save', 'update', 'create', 'delete', 'remove', 'insert', 'upsert', 'increment',
           'decrement', 'count', 'countBy', 'exists', 'existsBy', 'invalidateCache', 'clear',
           'softDelete', 'restore', 'preload', 'merge', 'getRepository', 'manager'}
# Verifiziert kein Entity-Zugriff.
EXTERNAL = {'Map', 'Set', 'Date', 'Array', 'Promise', 'JSON', 'Object', 'Queue', 'Subject',
            'Observable', 'QueueItem', 'QueueHandler', 'StorageService', 'RegisterStrategyRegistry',
            'Logger', 'EventEmitter2', 'HttpService', 'ConfigService', 'SchedulerRegistry',
            'I18nService', 'JwtService', 'Cron', 'Lock', 'ProcessService'}

ARROW = re.compile(r'\s*(?:\([^()]*\)|\w+)\s*=>')
REPOISH = re.compile(r'repo|repository', re.I)

def is_db_find(body, fm, cls):
    """Unterscheidet `repo.find({...})` von `array.find(x => ...)`.

    Arrays haben ebenfalls `find` - ohne diese Unterscheidung zaehlt jede Suche in einer
    Liste als Datenbankzugriff. `findOne`/`findBy`/`findAndCount` gibt es auf Arrays nicht,
    die sind eindeutig; nur `find` selbst braucht die Pruefung.
    """
    if fm.group(1) != 'find': return True
    if ARROW.match(body, fm.end()): return False          # Rueckruf statt Suchbedingung
    pre = body[max(0, fm.start() - 90):fm.start()]
    if re.search(r'getRepository\s*\([^)]*\)\s*$', pre): return True
    tm = re.search(r'this\s*\.\s*(\w+)\s*$', pre)
    if tm:
        t = INJECT.get(cls, {}).get(tm.group(1), '')
        return bool(REPOISH.search(tm.group(1)) or REPOISH.search(t or ''))
    if re.search(r'this\s*$', pre): return cls.endswith('Repository')
    vm = re.search(r'(\w+)\s*$', pre)
    return bool(vm and REPOISH.search(vm.group(1)))

SITES_OF = {}                    # (cls, meth) -> {(datei, zeile)}
METHODS = defaultdict(dict)      # cls -> meth -> list[body]
INJECT = defaultdict(dict)       # cls -> feld -> typ
DIRECT = defaultdict(dict)       # cls -> meth -> set(kategorien)

for f in sorted(glob.glob(os.path.join(SRC, '**', '*.ts'), recursive=True)):
    if '__tests__' in f or '.spec.' in f: continue
    s = read_text(f)
    s = re.sub(r'(?m)(?<!:)//[^\n]*', '', s)          # nur Zeilenkommentare, URLs geschuetzt
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
        # Parameterliste ueberspringen (destrukturierte Parameter sind sonst der "Rumpf")
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
        def at(off):                                   # Zeilennummer der Ladestelle
            return rel, s[:ob + 1 + off].count('\n') + 1
        for fm in FIND.finditer(mb):
            if is_db_find(mb, fm, cls):
                kinds.add('over'); sites.add(at(fm.start()))
        for qm in QB.finditer(mb):
            chain = mb[qm.end():qm.end() + 1500].split(';')[0]
            # `.update()/.delete()/.insert()` sind Schreib-Statements - sie laden nichts
            if re.search(r'\.(update|delete|insert|softDelete|restore)\s*\(', chain): continue
            kinds.add('proj' if re.search(r'\.select\(\s*\[', chain) else 'over')
            sites.add(at(qm.start()))
        for rm in RAW.finditer(mb):
            pre = mb[max(0, rm.start() - 60):rm.start()]
            if re.search(r'this\.(\w+)\s*$', pre) or re.search(r'this\s*$', pre):
                kinds.add('raw')

# ---- Aufrufgraph aufbauen (Kanten einmal, danach Fixpunkt statt Rekursion) ----
# Der Fixpunkt behandelt Zyklen exakt: eine Rekursion mit Zyklusabbruch liefert je nach
# Einstiegspunkt unterschiedliche Ergebnisse und speichert sie auch noch zwischen.
EDGES = defaultdict(set)
LOCAL_OK = {}
for cls in METHODS:
    for meth, bodies in METHODS[cls].items():
        key = (cls, meth)
        ok = True
        for body in bodies:
            # lokal erzeugte Objekte: `const txLogRepo = new LogRepository(manager)` und
            # anschliessend `txLogRepo.getFoo(...)` - ohne diesen Kantentyp bleibt eine
            # Transaktion, die ihr Repository selbst konstruiert, unsichtbar.
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
                    # ohne Rumpf: geerbte Schreib-/Zaehloperation laedt nichts,
                    # alles andere ist ein echter Zweifelsfall
                    if called not in NO_LOAD: ok = False
                    continue
                EDGES[key].add((sub_cls, called))
        LOCAL_OK[key] = ok

# Gemessene Spaltenzahl je Ladestelle (aus der TypeORM-Messung), Zuordnung ueber Datei+Zeile
with open(SP + '/sites-measured.json') as fh:
    _measured = json.load(fh)
MEAS = {(s['file'], s['line']): s.get('cols')
        for s in _measured if s.get('cols')}

KINDS = {k: set(DIRECT[k[0]].get(k[1], set())) for k in LOCAL_OK}
OK = dict(LOCAL_OK)
MAXCOL = {k: max([MEAS.get(x, 0) for x in SITES_OF.get(k, ())] or [0]) for k in LOCAL_OK}
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

def reach(cls, meth):
    key = (cls, meth)
    if key not in KINDS: return set(), False
    return KINDS[key], OK[key]

# ---- Von Hand aufgeloest: dynamische Ziele, die der Graph nicht erreicht ----
# Jeder Eintrag wurde in der Quelle gelesen. Begruendung dahinter. Keiner laedt im
# Anfragepfad aus der Datenbank.
MANUAL_NO_DB = {
    ('AlchemyController', 'addressWebhook'):    'HMAC-Pruefung gegen einen Schluessel im Arbeitsspeicher',
    ('AlchemyController', 'addresses'):         'Fremd-SDK (alchemy.notify), keine eigene Tabelle',
    ('AuthController', 'signInWithAlby'):       'baut nur eine OAuth-URL, Zustand im Arbeitsspeicher',
    ('YapealWebhookController', 'handleYapealWebhook'): 'reicht per rxjs-Subject weiter; das Laden '
                                                'geschieht beim Abnehmer, nicht im Anfragepfad',
    ('DexController', 'checkLiquidity'):        'Strategie-Registry; keine der Strategien in '
                                                'dex/strategies/{check,purchase,sell}-liquidity hat eine Ladestelle',
    ('DexController', 'purchaseLiquidity'):     'wie checkLiquidity',
    ('DexController', 'reserveLiquidity'):      'wie checkLiquidity',
    ('DexController', 'checkTransferCompletion'): 'wie checkLiquidity',
    ('DexController', 'transferLiquidity'):     'wie checkLiquidity',
    ('ExchangeController', 'getBalance'):       'Rueckruf auf einen Boersendienst (ccxt), keine Entity',
    ('ExchangeController', 'getPrice'):         'wie getBalance',
    ('ExchangeController', 'getTrades'):        'wie getBalance',
    ('ExchangeController', 'trade'):            'wie getBalance',
    ('ExchangeController', 'getTradeHistory'):  'wie getBalance',
    ('ExchangeController', 'withdrawFunds'):    'wie getBalance',
    ('ExchangeController', 'getWithdraw'):      'wie getBalance',
    ('C2BPaymentLinkController', 'kucoinPayWebhook'): 'Signaturpruefung; die erreichten Dienste '
                                                'C2BPaymentLinkService/PayInWebHookService haben keine Ladestelle',
    ('PayoutController', 'doPayout'):           'Fabrik erzeugt das Objekt, danach nur save() - reiner Schreibpfad',
    ('RealUnitController', 'getBrokerbotBuyPrice'):  'Preis aus dem Arbeitsspeicher-Cache bzw. von der Blockchain',
    ('RealUnitController', 'getBrokerbotBuyShares'): 'wie getBrokerbotBuyPrice',
    ('RealUnitController', 'getBrokerbotPrice'):     'wie getBrokerbotBuyPrice',
    ('RealUnitController', 'getQuoteBuyPrice'):      'wie getBrokerbotBuyPrice',
    ('RealUnitController', 'getQuoteBuyShares'):     'wie getBrokerbotBuyPrice',
    ('RealUnitController', 'getQuotePrice'):         'wie getBrokerbotBuyPrice',
    ('TatumController', 'addressWebhook'):      'Signaturpruefung, danach Fremd-SDK',
    ('AppController', 'getVersion'):            'liest dist/version.txt von der Platte',
}

with open(SP + '/table.json') as fh:
    eps = json.load(fh)
out = []
for r in eps:
    k, ok = reach(r['controller'], r['handler'])
    key = (r['controller'], r['handler'])
    manual = None
    if not k and not ok and key in MANUAL_NO_DB:
        ok, manual = True, MANUAL_NO_DB[key]
    out.append({**r, 'kinds': sorted(k), 'complete': ok, 'manual': manual,
                'maxcol': MAXCOL.get((r['controller'], r['handler']), 0)})
# Beruehrt ueberhaupt ein Spec diesen Endpunkt? Streng: dieselbe Datei nennt den Controller
# UND ruft den Handler auf. Schwaches Signal und Untergrenze - Specs, die eine Route ueber HTTP
# ansteuern, ohne den Handler zu nennen, fallen durch.
SPECS = [read_text(f)
         for f in glob.glob(os.path.join(SRC, '**', '*.spec.ts'), recursive=True)]
for r in out:
    pat = re.compile(r'\b' + re.escape(r['handler']) + r'\s*\(')
    r['spec'] = any(r['controller'] in txt and pat.search(txt) for txt in SPECS)

with open(SP + '/endpoint-eff.json', 'w') as fh:
    json.dump(out, fh, indent=1)

from collections import Counter
# Aufrufer-abhaengige Projektion: `request.select(query.select)` - nur projiziert, wenn der
# Aufrufer eine Feldliste mitschickt; ohne Angabe werden alle Spalten der Tabelle geladen.
CALLER_SELECT = {'/gs/db', '/gs/db/custom'}

def cat(e):
    if e['path'] in CALLER_SELECT: return 'aufrufer-abhaengig'
    k = set(e['kinds'])
    if 'over' in k: return 'ineffizient'
    if not k: return 'kein DB-Zugriff'
    if k <= {'proj', 'raw'}: return 'effizient'
    return 'unklar'

c = Counter(cat(e) for e in out)
print(f"Endpunkte gesamt: {len(out)}")
for k in ['ineffizient', 'kein DB-Zugriff', 'effizient', 'aufrufer-abhaengig', 'unklar']:
    if c[k]: print(f"  {k:20s} {c[k]:4d}  ({100*c[k]/len(out):.0f} %)")

ineff = [e for e in out if cat(e) == 'ineffizient']
mc = sorted((e['maxcol'] for e in ineff if e['maxcol']), reverse=True)
print(f"\nGroesste ausgeloeste Abfrage (gemessene Spalten), {len(mc)} von {len(ineff)} messbar:")
print(f"  ueber 1000 Spalten: {sum(1 for x in mc if x > 1000)}")
print(f"  ueber  500 Spalten: {sum(1 for x in mc if x > 500)}")
print(f"  ueber  100 Spalten: {sum(1 for x in mc if x > 100)}")
print(f"  Median: {mc[len(mc)//2]}")
print("\nSpitzenreiter:")
for e in sorted(ineff, key=lambda x: -x['maxcol'])[:8]:
    print(f"  {e['maxcol']:5d}  {e['verb']:6s} {e['path']}")
print("\nEffizient:")
for e in out:
    if cat(e) in ('effizient', 'aufrufer-abhaengig'):
        print(f"  {cat(e):20s} {e['verb']:6s} {e['path']:34s} {e['kinds']}")
