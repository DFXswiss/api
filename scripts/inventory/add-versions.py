#!/usr/bin/env python3
"""Ergaenzt table.json um die API-Version je Route.

Three sources, in this order:
  @Version(VERSION_NEUTRAL) on the handler -> served without a prefix ('neutral')
  @Controller({ path, version: [...] })  -> diese Version
  sonst                                  -> Config.defaultVersion = '1'
`GetConfig().kycVersion` ist in config.ts auf '2' gesetzt.
"""
import re, glob, os, json

SP = os.environ['GEN_SP']
SRC = os.environ['API_SRC']
DEFAULT_VERSION = '1'
NAMED = {'GetConfig().kycVersion': '2'}

HTTP = re.compile(r"@(Get|Post|Put|Delete|Patch)\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)")
CTRL_START = re.compile(r'@Controller\s*\(')

def ctrl_arg(s, i):
    """The argument of @Controller( ... ) — count brackets, skip string literals.

    `version: [GetConfig().kycVersion]` carries brackets of its own, so a pattern such as
    `\\{[^)]*\\}` bricht dort ab und liefert die Version nie.
    """
    depth, start = 0, i
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
            if depth == 0: return s[start + 1:i].strip()
        i += 1
    return ''

def scope_version(arg):
    """Version aus dem @Controller-Argument."""
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

versions = {}
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.controller.ts'), recursive=True)):
    if '__tests__' in f: continue
    s = open(f, encoding='utf-8', errors='replace').read()
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
        # The route's decorator block can override the version set on the handler
        block = s[m.start():m.start() + 900].split('\n')
        for line in block[:14]:
            vm = re.search(r'@Version\(\s*([^)]*)\s*\)', line)
            if vm:
                a = vm.group(1).strip()
                ver = 'neutral' if 'NEUTRAL' in a else a.strip('[]\'" ')
                break
        path = m.group(2) or ''
        full = ('/' + base + '/' + path).replace('//', '/').rstrip('/') or '/'
        versions.setdefault((m.group(1).upper(), full), []).append(ver)

rows = json.load(open(SP + '/table.json'))
used = {}
for r in rows:
    key = (r['verb'], r['path'])
    n = used.get(key, 0)
    lst = versions.get(key, [])
    r['version'] = lst[n] if n < len(lst) else DEFAULT_VERSION
    used[key] = n + 1
json.dump(rows, open(SP + '/table.json', 'w'), indent=1)

from collections import Counter
print('Versionen:', dict(Counter(r['version'] for r in rows)))
dup = [k for k, v in Counter((r['verb'], r['path'], r['version']) for r in rows).items() if v > 1]
print('Zeilen, die auch mit Version nicht unterscheidbar sind:', len(dup))
for k in dup: print('  ', k)
