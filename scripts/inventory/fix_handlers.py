#!/usr/bin/env python3
"""Korrigiert die Handler-Namen in table.json.

Fehler vorher: die Handler-Suche nahm die naechste Zeile, die am Zeilenanfang eingerueckt
mit `name(` beginnt. Bei mehrzeiligen Dekoratoren ist das der Guard, nicht die Methode:

    @Post('/personalIban')
    @UseGuards(
      AuthGuard(),          <-- wurde als Handler gelesen

Korrekt: nach dem Routen-Dekorator alle weiteren Dekoratoren ueberspringen (Klammern
zaehlen, dabei Zeichenketten und Kommentare respektieren), dann die Methode lesen.
Idempotent - erzeugt die Handler frisch aus der Quelle und mischt sie ueber (Pfad, Verb).
"""
import re, glob, os, json

SP = os.environ.get("INVENTORY_WORK")
if not SP:
    raise SystemExit("INVENTORY_WORK is not set - run this through scripts/inventory/run.sh")
SRC = os.environ.get("API_SRC")
if not SRC:
    raise SystemExit("API_SRC is not set - run this through scripts/inventory/run.sh")
HTTP = re.compile(r"@(Get|Post|Put|Delete|Patch)\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)")
DEC = re.compile(r'@(\w+)')
METH = re.compile(r'(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(')

def skip_trivia(s, i):
    """Leerraum und Kommentare ueberspringen."""
    while i < len(s):
        if s[i] in ' \t\r\n': i += 1
        elif s.startswith('//', i):
            nl = s.find('\n', i); i = len(s) if nl < 0 else nl + 1
        elif s.startswith('/*', i):
            e = s.find('*/', i); i = len(s) if e < 0 else e + 2
        else: break
    return i

def skip_args(s, i):
    """Ab der oeffnenden Klammer bis hinter die passende schliessende.

    Zeichenketten werden uebersprungen: Beschreibungstexte enthalten Klammern wie
    "1) Permit signature (ERC-2612)", deren ')' die Zaehlung sonst zerreisst.
    """
    depth = 0
    while i < len(s):
        c = s[i]
        if c in '\'"`':
            q, i = c, i + 1
            while i < len(s) and s[i] != q:
                i += 2 if s[i] == '\\' else 1
            i += 1
            continue
        if c == '(': depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0: return i + 1
        i += 1
    return i

def handler_after(s, i):
    while True:
        i = skip_trivia(s, i)
        d = DEC.match(s, i)
        if not d: break
        j = skip_trivia(s, d.end())
        i = skip_args(s, j) if j < len(s) and s[j] == '(' else d.end()
    m = METH.match(s, i)
    return m.group(1) if m else '?'

fresh = {}
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.controller.ts'), recursive=True)):
    if '__tests__' in f: continue
    s = open(f, encoding='utf-8', errors='replace').read()
    rel = f.replace(SRC + '/', 'src/')
    scopes = []
    for bm in re.finditer(r"@Controller\(\s*(?:(?:\{[^}]*path\s*:\s*)?['\"]([^'\"]*)['\"][^)]*)?\)", s):
        km = re.search(r'export\s+class\s+(\w+)', s[bm.end():bm.end() + 400])
        scopes.append((bm.start(), bm.group(1) or '', km.group(1) if km else '?'))
    if not scopes: continue
    for m in HTTP.finditer(s):
        verb, path = m.group(1).upper(), m.group(2) or ''
        base, cls = '', '?'
        for pos, b, c in scopes:
            if pos < m.start(): base, cls = b, c
            else: break
        full = ('/' + base + '/' + path).replace('//', '/').rstrip('/') or '/'
        fresh.setdefault((full, verb), []).append((cls, handler_after(s, m.end()), rel))

unresolved = [k for k, v in fresh.items() for c, h, r in v if h == '?']
print(f"Routen: {sum(len(v) for v in fresh.values())} | ohne erkannten Handler: {len(unresolved)}")
for k in unresolved: print('  ', k)

rows = json.load(open(SP + '/table.json'))
used, changed = {}, 0
for r in rows:
    key = (r['path'], r['verb'])
    cand = fresh.get(key, [])
    n = used.get(key, 0)
    if n < len(cand):
        cls, h, rel = cand[n]; used[key] = n + 1
        if r['handler'] != h: r['handler'] = h; changed += 1
        r['controller'], r['file'] = cls, rel
print(f"Handler in table.json korrigiert: {changed}")
json.dump(rows, open(SP + '/table.json', 'w'), indent=1)
