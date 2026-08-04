#!/usr/bin/env python3
"""Joins the measured column counts onto the freshly extracted load sites.

The join is made over (file, class, method, call, entity) rather than over the line number,
which moves in every edited file. That also lets a previous run's counts be carried forward
when the measurement itself is not repeated.

For a load site that projects, a carried-over count would be wrong anyway — it counts every
column of the entity. There the named columns are counted instead.
"""
import json, os, re, collections

SRC = os.environ['API_SRC']

fresh = json.load(open(os.environ['IN_SITES']))
old = json.load(open(os.environ['IN_MEASURED']))

by_key = collections.defaultdict(list)
for s in old:
    by_key[(s['file'], s['cls'], s['method'], s['call'], s['entity'])].append(s)

def chain_at(rel, line):
    text = open(os.path.join(SRC, rel[4:]), encoding='utf-8', errors='replace').read()
    lines = text.split('\n')
    start = sum(len(l) + 1 for l in lines[:line - 1])
    m = re.search(r'\.createQueryBuilder\s*\(', text[start:start + 400])
    if not m: return ''
    return text[start + m.end():start + m.end() + 1500].split(';')[0]

def named_columns(rel, line, chain):
    """How many columns does the query name?"""
    total = 0
    # Auch ein Variablen-Argument benennt eine Spalte: `.select(bucketExpr, 'bucket')`.
    for m in re.finditer(r'\.(?:select|addSelect)\s*\(\s*(\[|[\'"`]|[A-Za-z_$][\w$]*\s*[,)])', chain):
        if m.group(1) == '[':
            body = chain[m.end() - 1:]
            end = body.find(']')
            total += len(re.findall(r'[\'"`][^\'"`]+[\'"`]', body[:end] if end > 0 else body))
        else:
            total += 1
    if total: return total
    # Through ReadProjection: the field list lives in the constant, not at the load site.
    text = open(os.path.join(SRC, rel[4:]), encoding='utf-8', errors='replace').read()
    lines = text.split('\n')
    start = sum(len(l) + 1 for l in lines[:line - 1])
    am = re.search(r'\b([A-Z][A-Z0-9_]*)\s*\.\s*apply\s*\(', text[max(0, start - 200):start + 200])
    return PROJECTION_SIZES.get(am.group(1)) if am else None

# Size of each projection constant: fields plus guards.
#
# Aus der Laufzeit abgelesen (`fields.length + guards.length`), nicht aus dem Text geparst.
# Ein Parser dafuer war zweimal daneben - Guards in einer einzeiligen Konstante, dann eine
# Hilfsfunktion, die eine feste Zahl von Feldern liefert - und ein falscher Wert hier landet
# ungeprueft in der Doku. `read-projection.spec.ts` vergleicht die Zahlen in endpoints.md
# gegen die Projektionen selbst und wird rot, sobald diese Liste veraltet.
PROJECTION_SIZES = {
    'BUY_CRYPTO_BUY_HISTORY_PROJECTION': 12,
    'BUY_CRYPTO_ROUTE_HISTORY_PROJECTION': 12,
    'BUY_FIAT_HISTORY_PROJECTION': 14,
    'USER_PROFILE_PROJECTION': 41,
    'SUPPORT_ISSUE_PROJECTION': 11,
    'SUPPORT_ISSUE_DATA_PROJECTION': 81,
    'SUPPORT_MESSAGE_PROJECTION': 5,
    'WALLET_KYC_DATA_PROJECTION': 7,
    'USER_KYC_FILES_PROJECTION': 2,
    'CUSTODY_ORDER_HISTORY_PROJECTION': 14,
    'SUPPORT_ISSUE_LIST_PROJECTION': 10,
    'SUSPENSE_LEG_PROJECTION': 10,
    'PIPELINE_STATUS_PROJECTION': 2,
    'USER_V2_PROJECTION': 66,
    'API_KEY_PROJECTION': 3,
    'POS_LINK_PROJECTION': 7,
}

out, carried, counted, missing = [], 0, 0, 0
for s in fresh:
    rec = dict(s)
    if s['kind'] == 'query-builder' and s['select'] == 'count-only':
        # Die Kette endet auf getCount()/getExists(): COUNT(...) bzw. SELECT 1, keine Spalte.
        rec['cols'] = 0; rec['joins'] = 0; counted += 1
    elif s['kind'] == 'query-builder' and s['select'] in ('field-list', 'named-columns'):
        n = named_columns(s['file'], s['line'], chain_at(s['file'], s['line']))
        if n: rec['cols'] = n; rec['joins'] = 0; counted += 1
        else: missing += 1
    else:
        pool = by_key.get((s['file'], s['cls'], s['method'], s['call'], s['entity']))
        if pool:
            src = pool.pop(0)
            # `columns` is what the measurement writes; `cols` is what a previous join wrote.
            n = src.get('cols') if src.get('cols') is not None else src.get('columns')
            if n is not None: rec['cols'] = n; rec['joins'] = src.get('joins')
            carried += 1
        else:
            missing += 1
    out.append(rec)

json.dump(out, open(os.environ['OUT_MEASURED'], 'w'), indent=1)
print('load sites:', len(out))
print('  column count joined:', carried)
print('  columns counted (projections):', counted)
print('  without a column count:', missing)
print('  projection constants:', PROJECTION_SIZES)
