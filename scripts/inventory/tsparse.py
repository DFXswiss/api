#!/usr/bin/env python3
"""Shared TypeScript decorator parsing.

`make_table.py`, `fix_handlers.py` and `add_version_deprecated.py` all need to walk from a
route decorator to the method that follows it, skipping any decorators in between. Each used
to carry its own copy; a copy that drifts is how the handler column silently picks up a guard
name instead of the method. One implementation, three callers.
"""
import re

DEC = re.compile(r'@(\w+)')
METH = re.compile(r'(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(')
CTRL_START = re.compile(r'@Controller\s*\(')
HTTP = re.compile(r"@(Get|Post|Put|Delete|Patch)\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)")


def read_text(path):
    """Read a file completely and close the handle right away."""
    with open(path, encoding='utf-8', errors='replace') as fh:
        return fh.read()


def skip_trivia(s, i):
    """Skip whitespace and comments."""
    while i < len(s):
        if s[i] in ' \t\r\n':
            i += 1
        elif s.startswith('//', i):
            nl = s.find('\n', i)
            i = len(s) if nl < 0 else nl + 1
        elif s.startswith('/*', i):
            e = s.find('*/', i)
            i = len(s) if e < 0 else e + 2
        else:
            break
    return i


def skip_args(s, i):
    """From an opening parenthesis to just past its matching close.

    String literals are skipped whole: description texts contain parentheses such as
    "1) Permit signature (ERC-2612)" whose ')' would otherwise unbalance the count.
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
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return i


def decorator_block(s, i):
    """Text of every decorator between a route decorator and the method signature.

    Returns (block_text, position_after_block). Bracket counting rather than a fixed line
    window: a multi-line `@UseGuards(` or `@ApiOperation({ ... })` spans an arbitrary number
    of lines, and a window would cut it in half.
    """
    start = i
    while True:
        i = skip_trivia(s, i)
        d = DEC.match(s, i)
        if not d:
            break
        j = skip_trivia(s, d.end())
        i = skip_args(s, j) if j < len(s) and s[j] == '(' else d.end()
    return s[start:i], i


def block_and_handler(s, i):
    """(decorator block, handler name) starting at the end of a route decorator.

    The handler is `None` when no method signature follows — callers decide whether that is
    a hard error or a placeholder.
    """
    block, i = decorator_block(s, i)
    m = METH.match(s, i)
    return block, (m.group(1) if m else None)


def controller_arg(s, i):
    """Argument text of an `@Controller(` whose opening parenthesis is at i."""
    return s[i + 1:skip_args(s, i) - 1].strip()


def scope_path(arg):
    """Base path from a `@Controller` argument — a bare string or `{ path: '...' }`."""
    if not arg:
        return ''
    if arg.startswith('{'):
        m = re.search(r"path\s*:\s*['\"]([^'\"]*)['\"]", arg)
        return m.group(1) if m else ''
    return arg.strip('\'"')


def controller_scopes(s):
    """Every `@Controller` in a file as (position, base path, class name).

    A file may declare more than one controller class, and a route belongs to the scope that
    *precedes* it — `custody.controller.ts` declares both `custody` and `custody/admin`.
    """
    scopes = []
    for m in CTRL_START.finditer(s):
        arg = controller_arg(s, m.end() - 1)
        km = re.search(r'export\s+class\s+(\w+)', s[m.end():m.end() + 400])
        scopes.append((m.start(), scope_path(arg), km.group(1) if km else None))
    return scopes


def scope_at(scopes, pos):
    """The (base path, class name) in effect at position pos."""
    base, cls = '', None
    for spos, b, c in scopes:
        if spos < pos:
            base, cls = b, c
        else:
            break
    return base, cls


def full_path(base, path):
    """Join a controller base path and a route path the way Nest does."""
    return ('/' + base + '/' + path).replace('//', '/').rstrip('/') or '/'


def rel_path(src, path):
    """Repository-relative path (`src/...`) for a file found under SRC."""
    return 'src/' + path[len(src):].lstrip('/') if path.startswith(src) else path


def src_path(src, rel):
    """Inverse of rel_path: absolute path for a `src/...` reference."""
    return src.rstrip('/') + '/' + rel[4:] if rel.startswith('src/') else rel
