# Inventory generator

Regenerates [`docs/endpoints.md`](../../docs/endpoints.md) and [`docs/load-sites.md`](../../docs/load-sites.md) from the working tree.

Both documents are the work list for narrowing the read paths, and `CONTRIBUTING.md` obliges every
change that adds or moves an endpoint to keep them current. Until now the tool that produced them
lived outside the repository, which made that obligation impossible to meet. This is that tool.

## Running it

```bash
npm run build                 # the column counts come from the compiled entities
node scripts/inventory/run.js # writes to .inventory-out/ by default
```

No database is involved. A raw statement is not measured at all — it selects whatever it lists,
and the entity metadata cannot say what that is. For everything else a width comes from one of
three places. Where a query loads whole
rows it is measured against the real schema: the query is built from the TypeORM metadata and its
SELECT list counted. Where a query names its columns it is the number of names, counted in the
source. Where the field list comes from a `ReadProjection` constant it is that constant's size,
read off the built tree by `measure-columns.js` rather than copied into a table — a copy is right
on the day it is written and wrong on the day a projection gains a field.

Two of the three are therefore source counts rather than measurements against the schema. None of
them is silent when it fails: a query that names columns and yields no width stops the run and
names the site.

Python 3 and Node are the only prerequisites. The chain takes a few minutes, most of it in the
call-graph resolution.

## What each stage does

| Stage                   | Reads                    | Writes                                                                                                               |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `extract-load-sites.py` | `src/**/*.ts`            | `sites.json` — every call that reads from the database                                                               |
| `measure-columns.js`    | `dist`, `sites.json`     | `measured.json` — the SELECT width of each site, and `projections.json` — the size of each `ReadProjection` constant |
| `join-measurements.py`  | both of the above        | `sites-measured.json`                                                                                                |
| `extract-routes.py`     | `src/**/*.controller.ts` | `table.json` — one row per routing decorator                                                                         |
| `add-flags.py`          | `table.json`             | the API version per route and `@ApiOperation({ deprecated })`                                                        |
| `resolve-endpoints.py`  | both trees               | `endpoint-eff.json` — the union over every load site an endpoint reaches                                             |
| `render-docs.py`        | the two JSON files       | `endpoints.md`, `load-sites.md`                                                                                      |
| `probe-claims.js`       | `dist`                   | the schema-wide figures the prose quotes                                                                             |

The output goes to a directory, not over `docs/`. That is deliberate — see below.

## What the generator does not produce

**Two columns of `endpoints.md` are maintained by hand and a plain overwrite destroys them:**

- **`Tests`** — the state against the four levels in `read-path-projections.md`. No tool can derive
  it; it records a judgement about test coverage.
- **`Spec`** — derived, but a weak signal by construction: it says a spec file names the
  controller and calls the handler, not that the endpoint is covered. Where that derivation is
  known to be wrong, the column is corrected by hand, and such a correction must survive a
  regeneration.

**The prose is also hand-maintained.** The introductions, the limits sections and the worked
examples in both documents were corrected repeatedly during review; the templates in
`render-docs.py` carry the earlier wording. Regenerating replaces roughly forty lines of prose with
an older version of itself. Read the diff before accepting it.

So the working method is: run the generator, and transfer what actually changed — not the other way
round.

## How far the documents and this tool are apart

Measured on the tree this tool was committed against:

- `docs/endpoints.md` — **no differing rows**. Every route, classification, width and test state
  the generator produces is what the document already says.
- `docs/load-sites.md` — **111 column counts and 7 join counts** differ, almost all of them a
  handful of columns higher in the fresh run, plus one site whose entity does not resolve.

The remaining difference is not a defect on either side. Those numbers were published with the
measurement frozen at the epoch of the pull request that introduced the document, while the
generator measures the tree in front of it, and entities have gained columns since. For the width
of a query the fresh measurement is the current answer.

That is not a general rule, and it does not extend to `Tests` or to a hand-corrected `Spec`: there
the document is the record and the generator is the weaker signal. Read the diff per column, not
per file.

## Where it stops rather than guesses

- A query builder that names columns but yields no width means the field list came through a
  projection constant the run did not find in the built tree. The run stops and names the sites.
- A load site whose entity resolves but whose relation tree does not is reported by count and by
  site. It is not fatal: the document has a form for it, a dash in the width column, and five such
  sites exist today. A new one shows up in the log rather than in silence.

## What it cannot measure

One site projects on its root and pulls a joined entity in whole (`query-builder (projected, full
join)`). Its true width is neither the root entity nor the projection, and the chain is not
reconstructed here — the number shown is the root entity's width, and it is a genuine lower bound.
It is not alone in that: further query-builder sites carry a `leftJoinAndSelect` without being
classified as one, which is part of what the next section is about.

## What it gets wrong, not changed here

These all predate this tool being committed, they would move numbers the two documents already
publish, and they are now fixable by anyone because the code is here. They are stated rather than fixed so the
change stays what it says it is, and deliberately without figures: each of them would need its own
careful measurement, and a number stated loosely here would be one more claim to maintain.

**`exact` and `lower bound` are split on the wrong criterion.** `render-docs.py` calls a site exact
when a `relations` tree is written at the call, and a lower bound otherwise. That is right for a
`find` site, whose tree can arrive as a parameter so that only the base query is visible. It is
wrong for a query builder, which has no relations tree and into which none can arrive. The
exception is a query builder carrying a `leftJoinAndSelect`: there the joined entity is not counted, and the
width really is a lower bound. So the second group in `docs/load-sites.md` mixes two different
things, and the sentence explaining it is true only of the `find` sites in it.

**The extractor reads the source as text.** It follows a query builder from the call for a bounded
window and stops at the first semicolon it sees, so a long chain can be cut short and a builder
mutated elsewhere is not seen at all; and it does not remove block comments, so a commented-out
query still counts. A width from this tool is a reading of the source, not a trace of a running
query — which is what the four test levels in `read-path-projections.md` exist to settle
downstream.

**Some reads are not extracted, and the list that excludes them matches on the method name
alone.** `count`, `countBy`, `exists` and `existsBy` on a repository read the database without
materialising a row, exactly like the `getCount()` chains that _are_ recorded, yet the call-graph
resolution counts them among the operations that load nothing. The consequence is concrete and was
measured: at least one endpoint recorded as reading nothing — `GET /support/call-queues` — does
issue such a query.

The same list is matched against a method name on any receiver, not only on a repository, so an
ordinary service method that happens to share one of those names is silenced with it.
`LedgerMarkService.preload` is the example in this tree: it holds no load site of its own but
reaches one through `loadAssetPrices`, and the edge to it is dropped because `preload` is on the
list.

Neither is a matter of adding names: a count reads without materialising a row, so it needs the
width-zero treatment the `getCount()` sites get rather than the whole-rows treatment a `find` gets,
and the list needs to know what it is looking at rather than what it is called.

**The call graph keys symbols by class and method name alone**, and a good number of class names in
this repository are declared more than once — `KycService` and `KycController` in the deprecated
and the current generation, and the strategy families that repeat a name once per blockchain. Two
consequences. Bodies stored under the same class and method name are merged, which adds
reachability. More seriously, `INJECT` is keyed by class and field name, so where two same-named
classes declare the same field with different types — `BitcoinStrategy.bitcoinService` is
`PayInBitcoinService` in one copy and `PayoutBitcoinService` in another — the later declaration
wins and **every** method stored under that class name resolves through the survivor, whether or
not it collides. An edge can therefore point at the wrong service, which loses a real load site
rather than adding a spurious one. That is not the conservative direction, and it is not confined
to methods that collide.

## What this cannot check

Nothing verifies that the prose agrees with the tables it introduces. During review that gap
produced sentences quoting counts the tables contradicted, and the variants were found by hand
rather than by a check. `read-projection.spec.ts` pins the projection widths quoted in
`endpoints.md`; everything else in the prose is unguarded.
