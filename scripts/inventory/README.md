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

No database is involved. The counts come from the TypeORM metadata via `buildMetadatas()`, so the
numbers are measured against the real schema rather than estimated from the source text.

Python 3 and Node are the only prerequisites. The chain takes a few minutes, most of it in the
call-graph resolution.

## What each stage does

| Stage                   | Reads                    | Writes                                                                   |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `extract-load-sites.py` | `src/**/*.ts`            | `sites.json` — every call that reads from the database                   |
| `measure-columns.js`    | `dist`, `sites.json`     | `measured.json` — the SELECT width of each site                          |
| `join-measurements.py`  | both of the above        | `sites-measured.json`                                                    |
| `extract-routes.py`     | `src/**/*.controller.ts` | `table.json` — one row per routing decorator                             |
| `add-versions.py`       | `table.json`             | the API version per route                                                |
| `add-flags.py`          | `table.json`             | `@ApiOperation({ deprecated })`                                          |
| `resolve-endpoints.py`  | both trees               | `endpoint-eff.json` — the union over every load site an endpoint reaches |
| `render-docs.py`        | the two JSON files       | `endpoints.md`, `load-sites.md`                                          |
| `probe-claims.js`       | `dist`                   | the schema-wide figures the prose quotes                                 |

The output goes to a directory, not over `docs/`. That is deliberate — see below.

## What the generator does not produce

**Two columns of `endpoints.md` are maintained by hand and a plain overwrite destroys them:**

- **`Tests`** — the state against the four levels in `read-path-projections.md`. No tool can derive
  it; it records a judgement about test coverage.
- **`Spec`** — derived, but a weak signal by construction, and corrected by hand where the
  derivation is known to be wrong.

**The prose is also hand-maintained.** The introductions, the limits sections and the worked
examples in both documents were corrected repeatedly during review; the templates in
`render-docs.py` carry the earlier wording. Regenerating replaces roughly forty lines of prose with
an older version of itself. Read the diff before accepting it.

So the working method is: run the generator, and transfer what actually changed — not the other way
round.

## The documents and this tool do not agree exactly

Measured on the tree this tool was committed against, `docs/load-sites.md` differs from a fresh run
in **131 column counts and 28 join counts**, and `docs/endpoints.md` in **6 `Max cols` values and 3
`Spec` values**.

That is not a defect on either side. Those documents were published with the numbers frozen at the
measurement epoch of the pull request that introduced them, while the generator measures the tree in
front of it. Entities have gained columns since. Where the two disagree, **the generator is the
current answer and the document is the older one**.

Anyone regenerating should therefore expect a large numeric diff on the first run and should not
read it as breakage.

## What this cannot check

Nothing verifies that the prose agrees with the tables it introduces. During review that gap
produced sentences quoting counts the tables contradicted, and the variants were found by hand
rather than by a check. `read-projection.spec.ts` pins the projection widths quoted in
`endpoints.md`; everything else in the prose is unguarded.
