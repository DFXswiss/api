#!/usr/bin/env python3
"""Shared classification of a load site as read or write.

`build_docs.py` renders only sites that read; `apply_drift.py` must apply the same rule when
it inserts newly appeared sites into the published document. It used to filter on `write` and
`rawkind` keys that exist only inside `build_docs.py` and are never written to
`sites-measured.json` — so the filter matched nothing and write statements, advisory locks and
raw INSERTs would have been inserted as load sites. One implementation, both callers.
"""
import re

WRITE_CHAIN = re.compile(r'\.(update|delete|insert|softDelete|restore)\s*\(')
RAW_WRITE = re.compile(r'\bINSERT\b|\bUPDATE\b|\bDELETE\b')

# How a query builder narrows its column list. These strings travel through sites.json into
# the rendered documents, so they are named once here rather than spelled out at each use —
# a typo in a lookup key would silently read as "zero sites of this kind" instead of failing.
SEL_FIELD_LIST = 'field list'          # .select([...]) or PROJECTION.apply(...)
SEL_NAMED_COLUMNS = 'named columns'    # .select('alias.column') — names columns one by one
SEL_ALIAS_ONLY = 'alias only'          # .select('alias') — loads every column of the root
SEL_NO_SELECT = 'no select'            # no .select at all — loads every column
SEL_COUNT_ONLY = 'count only'          # getCount()/getExists() — no row is materialised
SEL_PROJECTED_FULL_JOIN = 'projected, full join'  # projects, but a JoinAndSelect loads whole

SELECT_KINDS = (SEL_FIELD_LIST, SEL_NAMED_COLUMNS, SEL_ALIAS_ONLY, SEL_NO_SELECT,
                SEL_COUNT_ONLY, SEL_PROJECTED_FULL_JOIN)

# Endpoints whose projection depends on the caller: `request.select(query.select)` projects
# only when a field list arrives with the request, and loads the full table otherwise.
CALLER_SELECT = {'/gs/db', '/gs/db/custom'}

_cache = {}


def _lines(src, rel):
    """Source lines of a `src/...` file, line comments stripped.

    Only line comments, and `[^\\n]*` never consumes the newline — so line numbers stay
    identical to the source and the (file, line) keys of every stage keep matching.
    """
    from tsparse import read_text, src_path
    if rel not in _cache:
        _cache[rel] = re.sub(r'(?m)(?<!:)//[^\n]*', '', read_text(src_path(src, rel))).split('\n')
    return _cache[rel]


def is_write_qb(src, s):
    """Does this `createQueryBuilder` chain carry a write terminator?"""
    chain = '\n'.join(_lines(src, s['file'])[s['line'] - 1:s['line'] + 25]).split(';')[0]
    return bool(WRITE_CHAIN.search(chain))


def raw_kind(src, s):
    """Raw SQL: an advisory lock, a write, or a genuine read."""
    body = '\n'.join(_lines(src, s['file'])[s['line'] - 1:s['line'] + 8])
    if 'pg_advisory' in body:
        return 'lock'
    if RAW_WRITE.search(body):
        return 'write'
    return 'read'


def annotate(src, sites):
    """Set `write` and `rawkind` on every site in place, and return the list.

    A site counts as a write when it is a query builder with a write terminator, or raw SQL
    that locks or writes. Everything else loads.
    """
    for s in sites:
        s['write'] = s['kind'] == 'query-builder' and is_write_qb(src, s)
        s['rawkind'] = raw_kind(src, s) if s['kind'] == 'raw-sql' else None
        if s['rawkind'] in ('lock', 'write'):
            s['write'] = True
    return sites
