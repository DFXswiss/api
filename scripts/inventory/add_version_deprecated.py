#!/usr/bin/env python3
"""Ergaenzt table.json um `deprecated` und bestimmt `version` aus dem vollen Dekoratorenblock.

Der Block zwischen Routen-Dekorator und Methode wird sauber abgegrenzt (Klammern zaehlen,
Zeichenketten und Kommentare respektieren) - ein Fenster ueber feste Zeilenzahl verfehlt
mehrzeilige @ApiOperation({ ... deprecated: true }).
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
DEFAULT_VERSION = '1'
NAMED = {'GetConfig().kycVersion': '2'}

HTTP = re.compile(r"@(Get|Post|Put|Delete|Patch)\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)")
CTRL_START = re.compile(r'@Controller\s*\(')
DEC = re.compile(r'@(\w+)')

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

def decorator_block(s, i):
    """Text aller Dekoratoren zwischen Routen-Dekorator und Methodensignatur."""
    start = i
    while True:
        i = skip_trivia(s, i)
        d = DEC.match(s, i)
        if not d: break
        j = skip_trivia(s, d.end())
        i = skip_args(s, j) if j < len(s) and s[j] == '(' else d.end()
    return s[start:i]

def ctrl_arg(s, i):
    return s[i + 1:skip_args(s, i) - 1].strip()

def scope_version(arg):
    if not arg or not arg.startswith('{'): return DEFAULT_VERSION
    m = re.search(r'version\s*:\s*\[([^\]]*)\]', arg)
    if not m: return DEFAULT_VERSION
    raw = m.group(1).strip().strip('\'"')
    return NAMED.get(raw, raw)

def scope_path(arg):
    if not arg: return ''
    if arg.startswith('{'):
        m = re.search(r"path\s*:\s*['\"]([^'\"]*)['\"]", arg)
        return m.group(1) if m else ''
    return arg.strip('\'"')

flags = {}
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.controller.ts'), recursive=True)):
    if '__tests__' in f: continue
    s = read_text(f)
    scopes = []
    for m in CTRL_START.finditer(s):
        a = ctrl_arg(s, m.end() - 1)
        scopes.append((m.start(), scope_path(a), scope_version(a)))
    if not scopes: continue
    for m in HTTP.finditer(s):
        base, ver = '', DEFAULT_VERSION
        for pos, b, v in scopes:
            if pos < m.start(): base, ver = b, v
            else: break
        block = decorator_block(s, m.end())
        vm = re.search(r'@Version\(\s*([^)]*)\s*\)', block)
        if vm:
            a = vm.group(1).strip()
            ver = 'neutral' if 'NEUTRAL' in a else a.strip('[]\'" ')
        dep = bool(re.search(r'deprecated\s*:\s*true', block))
        path = m.group(2) or ''
        full = ('/' + base + '/' + path).replace('//', '/').rstrip('/') or '/'
        flags.setdefault((m.group(1).upper(), full), []).append((ver, dep))

with open(SP + '/table.json') as fh:
    rows = json.load(fh)
used = {}
for r in rows:
    key = (r['verb'], r['path'])
    n = used.get(key, 0); used[key] = n + 1
    lst = flags.get(key, [])
    ver, dep = lst[n] if n < len(lst) else (DEFAULT_VERSION, False)
    r['version'], r['deprecated'] = ver, dep
with open(SP + '/table.json', 'w') as fh:
    json.dump(rows, fh, indent=1)

from collections import Counter
print('Versionen:', dict(Counter(r['version'] for r in rows)))
print('deprecated:', sum(1 for r in rows if r['deprecated']))
for r in rows:
    if r['deprecated']: print(f"   v{r['version']} {r['verb']:6s} {r['path']:34s} {r['controller']}.{r['handler']}")
