#!/usr/bin/env python3
"""Erzeugt table.json frisch aus den Controllern (verb, pfad, controller, handler, datei, intern).

Ersetzt den urspruenglichen Generator: Dekoratoren zwischen Routen-Dekorator und Methode werden
per Klammerzaehlung uebersprungen (Zeichenketten und Kommentare respektiert), sonst wird bei
mehrzeiligem @UseGuards( der Guard als Handler gelesen.
"""
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
CTRL_START = re.compile(r'@Controller\s*\(')
DEC = re.compile(r'@(\w+)')
METH = re.compile(r'(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(')

def skip_trivia(s, i):
    while i < len(s):
        if s[i] in ' \t\r\n': i += 1
        elif s.startswith('//', i):
            nl = s.find('\n', i); i = len(s) if nl < 0 else nl + 1
        elif s.startswith('/*', i):
            e = s.find('*/', i); i = len(s) if e < 0 else e + 2
        else: break
    return i

def skip_args(s, i):
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

def block_and_handler(s, i):
    """(Dekoratorenblock, Handlername) ab dem Ende des Routen-Dekorators."""
    start = i
    while True:
        i = skip_trivia(s, i)
        d = DEC.match(s, i)
        if not d: break
        j = skip_trivia(s, d.end())
        i = skip_args(s, j) if j < len(s) and s[j] == '(' else d.end()
    m = METH.match(s, i)
    return s[start:i], (m.group(1) if m else '?')

def scope_path(arg):
    if not arg: return ''
    if arg.startswith('{'):
        m = re.search(r"path\s*:\s*['\"]([^'\"]*)['\"]", arg)
        return m.group(1) if m else ''
    return arg.strip('\'"')

rows = []
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.controller.ts'), recursive=True)):
    if '__tests__' in f: continue
    s = read_text(f)
    rel = f.replace(SRC + '/', 'src/')
    scopes = []
    for m in CTRL_START.finditer(s):
        arg = s[m.end():skip_args(s, m.end() - 1) - 1].strip()
        km = re.search(r'export\s+class\s+(\w+)', s[m.end():m.end() + 400])
        scopes.append((m.start(), scope_path(arg), km.group(1) if km else '?'))
    if not scopes: continue
    for m in HTTP.finditer(s):
        base, cls = '', '?'
        for pos, b, c in scopes:
            if pos < m.start(): base, cls = b, c
            else: break
        block, handler = block_and_handler(s, m.end())
        full = ('/' + base + '/' + (m.group(2) or '')).replace('//', '/').rstrip('/') or '/'
        rows.append({'verb': m.group(1).upper(), 'path': full, 'controller': cls,
                     'handler': handler, 'file': rel,
                     'internal': '@ApiExcludeEndpoint' in block})

rows.sort(key=lambda r: (r['path'], r['verb']))
with open(SP + '/table.json', 'w') as fh:
    json.dump(rows, fh, indent=1)
print('Routen:', len(rows), '| ohne erkannten Handler:', sum(1 for r in rows if r['handler'] == '?'),
      '| intern:', sum(1 for r in rows if r['internal']))
