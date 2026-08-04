#!/usr/bin/env python3
"""Traegt die durch develop verursachte Drift in ein VEROEFFENTLICHTES load-sites.md ein.

Warum nicht neu erzeugen: die veroeffentlichten Dokumente sind einmal generiert und danach ueber
fuenf Pruefrunden von Hand korrigiert worden (Median, Paar-Zahl, Obergrenzen-Vorbehalt, englische
Labels, Zielsatz). Der Generator kennt nichts davon und traegt ausserdem bereits die
Klassifikationskorrekturen des Nachfolge-PR. Ein Neu-Erzeugen wuerde beides verwerfen.

Uebertragen wird deshalb nur, was der Vergleich ZWEIER Laeufe DERSELBEN Kette ergibt:
  - Ladestellen, die es neu gibt      -> Zeile einfuegen, mit ihrer gemessenen Breite
  - Ladestellen, die es nicht mehr gibt -> Zeile entfernen
  - Ladestellen, deren Zeilennummer wanderte -> Verweis nachziehen

Die Spaltenzahl bestehender Zeilen bleibt, wie sie veroeffentlicht wurde: sie stammt aus dem
Regelstand dieses PR, und die Messung hat sich fuer sie nicht geaendert.
"""
import json, os, re, statistics, subprocess, sys
from collections import defaultdict

S = os.environ.get("INVENTORY_WORK")
if not S:
    raise SystemExit("INVENTORY_WORK is not set - see tools/inventory/README.md")
REPO = os.environ.get("INVENTORY_REPO")
if not REPO:
    raise SystemExit("INVENTORY_REPO is not set - see tools/inventory/README.md")

# Deutsche Generator-Labels auf die englischen der veroeffentlichten Tabelle abbilden.
LABEL = {
    'query-builder (nur-alias)': 'query-builder (alias only)',
    'query-builder (ohne-select)': 'query-builder (no select)',
    'query-builder (feldliste)': 'query-builder (field list)',
    'query-builder (spaltenliste)': 'query-builder (named columns)',
    'query-builder (zaehlend)': 'query-builder (count only)',
    'query-builder (projektion-mit-vollem-join)': 'query-builder (projected, full join)',
}
KEY = lambda s: (s['file'], s['cls'], s['method'], s['call'], s['entity'])
CELL = lambda r, i: r.split('|')[i].strip().strip('`')


def rows_of(text):
    return [l for l in text.split('\n')
            if l.startswith('|') and len(l.split('|')) == 8 and not re.match(r'^\|[\s:|-]+\|$', l)]


def render(s):
    """Eine Zeile im Format der veroeffentlichten Tabelle."""
    cols = s.get('cols')
    c = '—' if cols is None else str(cols)
    j = '—' if cols is None else str(s.get('joins') or 0)
    mech = LABEL.get(s['sel_label'], s['sel_label'])
    ent = s.get('entity') or '—'
    return f"| {c} | {j} | {mech} | `{ent}` | `{s['file'][4:]}:{s['line']}` | `{s['cls']}.{s['method']}` |"


def label_of(s):
    if s['kind'] == 'find':
        return 'find'
    if s['kind'] == 'raw-sql':
        return 'raw-sql'
    return 'query-builder (%s)' % s.get('select', 'ohne-select')


def main(pub_ref, pub_path, out_path):
    pub = subprocess.run(["git", "-C", REPO, "show", f"{pub_ref}:{pub_path}"],
                         capture_output=True, text=True).stdout
    old = json.load(open(S + "/gen/old/sites-measured.json"))
    new = json.load(open(S + "/gen/new/sites-measured.json"))

    by_line = {(s['file'], s['line']): s for s in old}
    old_pool = defaultdict(list)
    for s in old:
        old_pool[KEY(s)].append(s)
    new_pool = defaultdict(list)
    for s in new:
        new_pool[KEY(s)].append(s)

    body = rows_of(pub)
    header, data = body[0], body[1:]

    kept, dropped, moved = [], 0, 0
    used = defaultdict(int)
    for r in data:
        f, ln = CELL(r, 5).rsplit(':', 1)
        o = by_line.get(('src/' + f, int(ln)))
        if o is None:                      # im Alt-Lauf nicht gefunden: unveraendert uebernehmen
            kept.append(r)
            continue
        k = KEY(o)
        pool = new_pool.get(k, [])
        idx = used[k]
        if idx >= len(pool):               # existiert auf develop nicht mehr
            dropped += 1
            continue
        used[k] += 1
        nline = pool[idx]['line']
        if nline != o['line']:
            r = r.replace(f"`{f}:{ln}`", f"`{f}:{nline}`")
            moved += 1
        kept.append(r)

    # Neue Ladestellen: alles im neuen Lauf, was der Abgleich oben nicht verbraucht hat
    added = []
    for k, pool in new_pool.items():
        for s in pool[used.get(k, 0):]:
            if not s.get('write'):
                s = dict(s, sel_label=label_of(s))
                added.append(s)

    # Schreib-Statements und Locks gehoeren nicht in die Tabelle - dieselbe Regel wie im Generator
    added = [s for s in added if s.get('rawkind') not in ('lock', 'write')]

    rows = kept + [render(s) for s in added]
    width = lambda r: (lambda c: int(c) if re.fullmatch(r'\d+', c) else -1)(CELL(r, 1))
    rows.sort(key=lambda r: -width(r))

    nums = sorted(width(r) for r in rows if width(r) >= 0)
    stats = dict(zeilen=len(rows), gemessen=len(nums), median=statistics.median(nums),
                 maxbreite=max(nums), ueber1000=sum(1 for v in nums if v > 1000),
                 ueber500=sum(1 for v in nums if v > 500), ueber100=sum(1 for v in nums if v > 100))
    print(f"  uebernommen={len(kept)}  entfernt={dropped}  Zeilenverweis nachgezogen={moved}  neu={len(added)}")
    print(f"  Ergebnis: {json.dumps(stats, default=str)}")

    out = pub.split('\n')
    first = out.index(header)
    last = max(i for i, l in enumerate(out) if l.startswith('|') and len(l.split('|')) == 8)
    out = out[:first + 2] + rows + out[last + 1:]
    open(out_path, 'w', encoding='utf-8').write('\n'.join(out))
    json.dump(stats, open(out_path + '.stats.json', 'w'), default=str)


if __name__ == '__main__':
    main(*sys.argv[1:])
