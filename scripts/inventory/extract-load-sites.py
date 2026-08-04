#!/usr/bin/env python3
"""Extracts EVERY load site in the code. Locally decidable, no call-chain heuristic.

A load site is a call that reads from the database. Per site this records the file, the line,
festgehalten: Datei, Zeile, umgebende Klasse/Methode, Ziel-Entity, Lademechanik.
The column count is then measured by TypeORM itself, in measure-columns.js.
"""
import re, glob, os, json

SP = os.environ['GEN_SP']
import os
SRC = os.environ['API_SRC']

# Reading calls. save/update/delete are write paths and are deliberately absent.
READ = re.compile(r'\.(find|findOne|findBy|findOneBy|findAndCount|findOneOrFail|'
                  r'findCached|findCachedBy|findOneCached|findOneCachedBy|'
                  r'createQueryBuilder|query)\s*\(')
CLASSRE = re.compile(r'export\s+(?:abstract\s+)?class\s+(\w+)')
SIG = re.compile(r'^\s{2,}(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(', re.M)

def strip_comments(s):
    # nur Zeilenkommentare, URLs geschuetzt; Blockkommentare NICHT (Regex-Literale)
    return re.sub(r'(?m)(?<!:)//[^\n]*', '', s)

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
    s = open(f, encoding='utf-8', errors='replace').read()
    if '@Entity(' in s or '@ChildEntity(' in s:
        ENTITIES.update(m.group(1) for m in CLASSRE.finditer(s))

sites = []
for f in sorted(glob.glob(os.path.join(SRC, '**', '*.ts'), recursive=True)):
    if '__tests__' in f or '.spec.' in f: continue
    # Test infrastructure is not a load site of the application: it creates the schema and
    # erzeugt Fixtures, laeuft aber nie im Anfragepfad.
    if f.endswith('projection-test.util.ts'): continue
    raw = open(f, encoding='utf-8', errors='replace').read()
    if not READ.search(raw): continue
    s = strip_comments(raw)
    rel = f.replace(SRC + '/', 'src/')

    classes = [(m.start(), m.group(1)) for m in CLASSRE.finditer(s)]
    # Kontrollstrukturen sehen wie Methodensignaturen aus - herausfiltern
    KW = {'if','for','while','switch','catch','return','do','else','try','constructor'}
    # Grossbuchstaben-Bezeichner sind SQL-Schluesselwoerter aus Template-Literalen, keine
    # Methoden: `CASE WHEN ... THEN (` traf die Signaturregel und wanderte als angebliche
    # Methode `THEN` ins Inventar.
    methods = [(m.start(), m.group(1)) for m in SIG.finditer(s)
               if m.group(1) not in KW and not m.group(1).isupper()]
    def enclosing(pos, lst):
        cur = None
        for p, n in lst:
            if p < pos: cur = n
            else: break
        return cur

    # Feld -> Typ (dateiweit; Kollisionen sind hier unkritisch, es geht um lokale Zuordnung)
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

        # Ziel bestimmen: this.<feld>.<call>()  |  this.<call>()  |  <var>.<call>()
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

        # Mechanik: eager oder projiziert
        if call in ('createQueryBuilder', 'query'):
            kind = 'raw-sql' if call == 'query' else 'query-builder'
        else:
            kind = 'find'

        # the relations tree, where it is written at the call
        tree = None
        tail = s[m.end():m.end() + 4000]
        rm = re.search(r'relations\s*:\s*\{', tail)
        if rm and rm.start() < 600:
            try:
                t2, _ = parse_obj(tail, rm.end() - 1)
                if t2: tree = norm(t2)
            except Exception: pass

        # Bei einem QueryBuilder: folgt eine explizite Feldliste?
        select = None
        if call == 'createQueryBuilder':
            window = s[m.end():m.end() + 1500]
            # bis zum Ende der Kette schauen (grob: bis zum naechsten ';')
            chain = window.split(';')[0]
            # `.select('alias')` laedt jede Spalte; `.select('alias.spalte')` nennt eine.
            # Both are string literals — the dot in the first argument is what separates them.
            # Without this distinction every column-wise projection would count as a full read.
            # `PROJECTION.apply(this.createQueryBuilder('x'), fields)`: die Feldliste steht in
            # the projection constant. Without this case every query built that way would count as
            # Vollzugriff, obwohl sie genau das Gegenteil ist.
            # The call may read `PROJECTION.apply(this.createQueryBuilder(...))` or arrive through
            # ein injiziertes Repository gehen: `PROJECTION.apply(this.orderRepo.createQueryBuilder(...))`.
            # `getCount()` und `getExists()` verwerfen die Auswahlliste und setzen COUNT(...) bzw.
            # SELECT 1 - solche Ketten materialisieren keine Zeile, egal was davor steht.
            if re.search(r'\.(getCount|getExists)\s*\(\s*\)', chain):
                sites.append({'file': rel, 'line': line, 'cls': cls, 'method': meth,
                              'call': call, 'kind': kind, 'entity': entity, 'via': via,
                              'relations': tree, 'select': 'count-only'})
                continue
            # Zwischen `apply(` und `createQueryBuilder` steht dann eine Objektkette.
            before = s[max(0, m.start() - 160):m.start()]
            if re.search(r'\b[A-Z][A-Z0-9_]*\s*\.\s*apply\s*\(\s*(?:this|[A-Za-z_$][\w$]*)(?:\s*\.\s*[\w$]+)*$', before):
                select = 'field-list'
            elif re.search(r'\.select\(\s*\[', chain): select = 'field-list'
            elif re.search(r'\.select\(\s*[A-Za-z_$][\w$]*\s*[,)]', chain):
                # `.select(bucketExpr, 'bucket')` - das Argument steht in einer Variablen. Die im
                # Rumpf zugewiesene Form entscheidet: ein blosser Bezeichner waere der Wurzel-Alias,
                # alles andere benennt etwas.
                v = re.search(r"\.select\(\s*([A-Za-z_$][\w$]*)\s*[,)]", chain)
                a = re.search(r"\b(?:const|let|var)\s+" + re.escape(v.group(1)) + r"\s*=\s*([^;\n]+)", s[max(0, m.start() - 1500):m.start()])
                if a and not re.fullmatch(r"['\"`]\w+['\"`]", a.group(1).strip()):
                    select = 'named-columns'
                else:
                    select = 'no-select'
            elif re.search(r'\.select\(\s*[\'"`]', chain):
                first = re.search(r'\.select\(\s*[\'"`]([^\'"`]*)[\'"`]', chain)
                arg = first.group(1) if first else ''
                # Ein blosser Bezeichner ist der Wurzel-Alias und laedt jede Spalte. Alles andere
                # nennt etwas Bestimmtes: eine Spalte (`userData.id`) oder einen Ausdruck
                # (`COUNT(*)`, `MAX(tx.seq)`), und beides schraenkt die Abfrage ein.
                select = 'alias-only' if re.fullmatch(r'\w+', arg.strip()) else 'named-columns'
            else: select = 'no-select'
            # Ein `leftJoinAndSelect` holt die gejointe Entity vollstaendig - dann hilft die
            # Projektion auf der Wurzel nicht mehr.
            if select in ('field-list', 'named-columns') and re.search(r'(?:left|inner)JoinAndSelect\s*\(', chain):
                select = 'projected-full-join'

        sites.append({'file': rel, 'line': line, 'cls': cls, 'method': meth,
                      'call': call, 'kind': kind, 'entity': entity, 'via': via,
                      'relations': tree, 'select': select})

json.dump(sites, open(SP + '/sites.json', 'w'), indent=1)
from collections import Counter
print(f"load sites found: {len(sites)}")
print("  nach Mechanik:", dict(Counter(s['kind'] for s in sites)))
print(f"  mit aufloesbarer Entity: {sum(1 for s in sites if s['entity'])}")
print(f"  davon mit relations-Baum: {sum(1 for s in sites if s['relations'])}")
print(f"  Dateien: {len({s['file'] for s in sites})}")
