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

# Which of them actually narrow the query. A field list and column-by-column naming do;
# `getCount()`/`getExists()` materialise no row at all. Selecting the bare alias reads like a
# projection but loads every column, and a projection undone by a `leftJoinAndSelect` loads the
# joined entity whole.
NARROWING = frozenset({SEL_FIELD_LIST, SEL_NAMED_COLUMNS, SEL_COUNT_ONLY})

APPLY_HELPER = re.compile(
    r'\b[A-Z][A-Z0-9_]*\s*\.\s*apply\s*\(\s*(?:this|[A-Za-z_$][\w$]*)(?:\s*\.\s*[\w$]+)*$')
COUNTING = re.compile(r'\.(getCount|getExists)\s*\(\s*\)')
SELECT_BRACKET = re.compile(r'\.select\(\s*\[')
SELECT_IDENT = re.compile(r'\.select\(\s*([A-Za-z_$][\w$]*)\s*[,)]')
SELECT_STRING = re.compile(r'\.select\(\s*[\'"`]([^\'"`]*)[\'"`]')
JOIN_AND_SELECT = re.compile(r'(?:left|inner)JoinAndSelect\s*\(')
LINE_COMMENT = re.compile(r'(?m)(?<!:)//[^\n]*')


def strip_line_comments(s):
    """Strip line comments only, protecting URLs.

    Block comments are left alone because a regex literal can look like one. `[^\\n]*` never
    consumes the newline, so line numbers stay identical to the source — every stage keys on
    (file, line) and the whole join depends on all of them stripping identically. Hence one
    implementation rather than a copy per stage.
    """
    return LINE_COMMENT.sub('', s)


def select_kind(text, m_start, m_end):
    """Category of a `createQueryBuilder` call at [m_start, m_end) within text.

    Shared between the site scan and the per-endpoint call-graph walk. They used to decide this
    separately, and the call-graph copy recognised only a literal `.select([`: every endpoint
    projecting through the `PROJECTION.apply(...)` helper or naming its columns one at a time
    was classified as loading whole rows — including all of the deliberately converted ones.
    """
    chain = text[m_end:m_end + 1500].split(';')[0]
    # `getCount()`/`getExists()` discard the select list and emit COUNT(...) resp. SELECT 1 -
    # such chains materialise no row, whatever precedes them.
    if COUNTING.search(chain):
        return SEL_COUNT_ONLY
    # `PROJECTION.apply(this.createQueryBuilder('x'), fields)`: the field list lives in the
    # projection constant, so the `.select([...])` is in another file entirely. The call may
    # also go through an injected repository, putting an object chain between `apply(` and
    # `createQueryBuilder`.
    before = text[max(0, m_start - 160):m_start]
    if APPLY_HELPER.search(before):
        select = SEL_FIELD_LIST
    elif SELECT_BRACKET.search(chain):
        select = SEL_FIELD_LIST
    elif SELECT_IDENT.search(chain):
        # `.select(bucketExpr, 'bucket')` - the argument sits in a variable. What the body
        # assigns decides: a bare identifier would be the root alias, anything else names
        # something.
        v = SELECT_IDENT.search(chain)
        a = re.search(r"\b(?:const|let|var)\s+" + re.escape(v.group(1)) + r"\s*=\s*([^;\n]+)",
                      text[max(0, m_start - 1500):m_start])
        select = SEL_NAMED_COLUMNS if a and not re.fullmatch(r"['\"`]\w+['\"`]", a.group(1).strip()) \
            else SEL_NO_SELECT
    elif SELECT_STRING.search(chain):
        arg = SELECT_STRING.search(chain).group(1)
        # `.select('alias')` loads every column; `.select('alias.column')` names one. Both are
        # strings - the dot in the argument is the difference. A bare identifier is the root
        # alias; anything else names something specific: a column (`userData.id`) or an
        # expression (`COUNT(*)`, `MAX(tx.seq)`), and both narrow the query.
        select = SEL_ALIAS_ONLY if re.fullmatch(r'\w+', arg.strip()) else SEL_NAMED_COLUMNS
    else:
        select = SEL_NO_SELECT
    # A `leftJoinAndSelect` fetches the joined entity whole - the projection on the root no
    # longer helps then.
    if select in (SEL_FIELD_LIST, SEL_NAMED_COLUMNS) and JOIN_AND_SELECT.search(chain):
        select = SEL_PROJECTED_FULL_JOIN
    return select


def raw_kind_of(body):
    """Raw SQL classified from the statement text: an advisory lock, a write, or a read."""
    if 'pg_advisory' in body:
        return 'lock'
    if RAW_WRITE.search(body):
        return 'write'
    return 'read'

# Endpoints whose projection depends on the caller: `request.select(query.select)` projects
# only when a field list arrives with the request, and loads the full table otherwise.
CALLER_SELECT = {'/gs/db', '/gs/db/custom'}

_cache = {}


def _lines(src, rel):
    """Source lines of a `src/...` file, line comments stripped."""
    from tsparse import read_text, src_path
    if rel not in _cache:
        _cache[rel] = strip_line_comments(read_text(src_path(src, rel))).split('\n')
    return _cache[rel]


def is_write_qb(src, s):
    """Does this `createQueryBuilder` chain carry a write terminator?"""
    chain = '\n'.join(_lines(src, s['file'])[s['line'] - 1:s['line'] + 25]).split(';')[0]
    return bool(WRITE_CHAIN.search(chain))


def raw_kind(src, s):
    """Raw SQL at a recorded site: an advisory lock, a write, or a genuine read."""
    return raw_kind_of('\n'.join(_lines(src, s['file'])[s['line'] - 1:s['line'] + 8]))


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
