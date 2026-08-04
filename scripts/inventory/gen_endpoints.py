#!/usr/bin/env python3
"""Erzeugt die Endpunkt-Tabelle aus den Controllern und verifiziert sie gegen die Routenliste."""
import re, glob, os, json

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

HTTP = re.compile(r"@(Get|Post|Put|Delete|Patch)\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)")
SIG = re.compile(r'^\s{2}(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(', re.M)

rows = []
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.controller.ts'), recursive=True)):
    if '__tests__' in f: continue
    s = read_text(f)
    # Eine Datei kann mehrere @Controller-Klassen mit verschiedenen Basispfaden enthalten
    # (z.B. 'custody' und 'custody/admin'). Jeden Endpunkt dem vorangehenden zuordnen.
    scopes = []
    # auch @Controller() ohne Argument -> leerer Basispfad (Routen liegen dann an der Wurzel)
    for bm in re.finditer(r"@Controller\(\s*(?:(?:\{[^}]*path\s*:\s*)?['\"]([^'\"]*)['\"][^)]*)?\)", s):
        km = re.search(r'export\s+class\s+(\w+)', s[bm.end():bm.end() + 400])
        scopes.append((bm.start(), bm.group(1) or '', km.group(1) if km else '?'))
    if not scopes: continue
    rel = f.replace(SRC + '/', 'src/')
    for m in HTTP.finditer(s):
        verb, path = m.group(1).upper(), m.group(2) or ''
        base, cls = '', '?'
        for pos, b, c in scopes:
            if pos < m.start(): base, cls = b, c
            else: break
        sm = SIG.search(s, m.end())
        handler = sm.group(1) if sm else '?'
        # Sichtbarkeit: als intern markierte Endpunkte kennzeichnen
        window = s[max(0, m.start() - 700):m.end()]
        internal = '@ApiExcludeEndpoint' in window
        full = ('/' + base + '/' + path).replace('//', '/').rstrip('/') or '/'
        rows.append({'verb': verb, 'path': full, 'controller': cls,
                     'handler': handler, 'file': rel, 'internal': internal})

rows.sort(key=lambda r: (r['path'], r['verb']))

# Verifikation gegen die Routenliste der laufenden Anwendung
ref = set()
p = SP + '/prod-norm.txt'
if os.path.exists(p):
    with open(p) as fh:
        for line in fh:
            parts = line.strip().split(' ', 1)
            if len(parts) == 2: ref.add((parts[0].upper(), parts[1]))
mine = set((r['verb'], r['path']) for r in rows)
print(f"Endpunkte aus dem Code:        {len(rows)} ({len(mine)} eindeutige Verb/Pfad-Paare)")
if ref:
    print(f"Referenz (registrierte Routen): {len(ref)}")
    print(f"  nur im Code:      {len(mine - ref)}  {sorted(mine - ref)[:6]}")
    print(f"  nur in Referenz:  {len(ref - mine)}  {sorted(ref - mine)[:6]}")
    print(f"  Deckung:          {100*len(mine & ref)/max(len(ref),1):.1f} %")

with open(SP + '/endpoints.json', 'w') as fh:
    json.dump(rows, fh, indent=1)
by_ctrl = {}
for r in rows: by_ctrl.setdefault(r['controller'], []).append(r)
print(f"\nController: {len(by_ctrl)}   intern markiert: {sum(1 for r in rows if r['internal'])}")
