# Endpoint and load-site inventory

## What this is

`docs/endpoints.md` and `docs/load-sites.md` are generated inventories of every HTTP route and every database read site in this service, respectively.

These scripts need Python 3 in addition to Node. `run.sh` checks for `python3` before it starts.

## Do not simply regenerate

The published documents contain passages that were adjusted by hand after their initial generation: median figures, the "at most ... an upper bound" caveat, the "Known discrepancy" section. The renderer, `build_docs.py`, does not produce these passages.

For that reason `npm run docs:inventory` **does not touch `docs/`**. It leaves both documents in its work directory and prints the path, so you can diff them against the published ones. Overwriting the published documents — and discarding their hand-adjusted passages — takes an explicit flag:

```bash
bash scripts/inventory/run.sh --write-docs
```

A fresh run does reproduce the published *classification* exactly. Run against `06226c90b`, the commit the documents were published from, all 537 endpoints match the published `Data access` and `Tests` columns — 410 `whole rows`, 36 `projected`, 89 `none`, 2 `caller-defined` — and all 18 measured field lists match column for column.

Two things it does not reproduce:

- the hand-written prose around the tables;
- `Max cols` for one of the 537 endpoints. `GET /dashboard/financial/ref-recipients` comes out at 4 against a published 2 — and the run is right: `getRewardRecipients` selects `userDataId`, `count`, `amountCount` and `totalChf`. The published figure predates the fix to counting columns named one at a time.

  Six further endpoints differed until the measurement was corrected. `setFindOptions()` was applied to every site, which expands eager relations — something `find*` does and a query builder does not. The `PriceRule` sites measured 53 columns against the entity's 20, and `GET /pricing/price` 53 against a published 33. With the call restricted to `find` sites, all six match.

Treat a fresh run as a data source, not as a replacement for the documents.

## Keeping the documents current

Use `apply_drift.py` to keep the published `docs/load-sites.md` current after code changes. It handles that document only; `docs/endpoints.md` has no drift tool and is maintained by hand. Run the same inventory pipeline twice: once on the commit from which the document was published and once on the current commit. `apply_drift.py` compares the two runs and applies only the following changes to the published `load-sites.md`:

- insert rows for new load sites;
- remove rows for load sites that no longer exist;
- update references when source line numbers move.

Column counts already present in the published document remain unchanged. Write statements, advisory locks and raw `INSERT`s are excluded from the inserted rows, by the same rule the renderer applies — both call `classify.py`.

**It rewrites the table only.** The counts in the surrounding prose ("N load sites across M files", the median figures under *Measurements*) are not updated. The script prints the new statistics and writes them to `<out_path>.stats.json`; carry them into the prose by hand.

The script requires three environment variables:

- `INVENTORY_WORK`: a working directory containing the intermediate files from both runs, under `gen/old/` and `gen/new/`.
- `INVENTORY_REPO`: the path to a clone from which the script reads the published version with `git show <ref>:<path>`.
- `API_SRC`: the source tree of the *new* state, needed to classify newly appeared sites as read or write.

Invoke it as follows:

```bash
python3 apply_drift.py <pub_ref> <pub_path> <out_path>
```

## Full pipeline

`scripts/inventory/run.sh` runs the following steps in order, writing intermediates under a temporary `INVENTORY_WORK` directory. The directory is printed on stdout and kept after the run for inspection — it holds a full inventory, so remove it when you are done.

1. `sites.py` extracts every load site from `src/` and writes `sites.json`.
2. `measure.js` measures SELECT column counts from TypeORM metadata in `dist/` and writes `sites-measured.json` and `meta-tables.json`. The latter contains per-table TypeORM metadata: column counts and entity names, one entry per table.
3. `make_table.py` extracts every route from the controllers and writes `table.json`, the endpoint table containing verb, path, controller, handler, file, and internal status.
4. `add_version_deprecated.py` adds `version` and `deprecated` to each row of `table.json`, using the full decorator block (`@Version`, `deprecated: true`).
5. `endpoint_eff.py` joins the routes in `table.json` with the load sites they can reach and their over-fetch kinds, then writes `endpoint-eff.json`.
6. `build_docs.py` renders `endpoints.md` and `load-sites.md` into the work directory.

Two shared modules carry the contracts the steps used to duplicate:

- `tsparse.py` — the decorator walk from a route decorator to its method, plus `@Controller` scope resolution. Steps 3, 4 and 5 all need it; three copies of it are three chances to drift.
- `classify.py` — the names of the select categories, the rule that decides whether a query builder narrows its columns, the rule that decides whether a site reads or writes, and the comment stripping that keeps `(file, line)` keys aligned across stages. Used by `sites.py`, `endpoint_eff.py`, `build_docs.py` and `apply_drift.py`.

The site scan and the per-endpoint call-graph walk are two independent passes over the same code, and both have to answer "does this query builder narrow its columns". They answered it separately until the walk was found to recognise only a literal `.select([...])`: an endpoint projecting through the `PROJECTION.apply(...)` helper, naming its columns one at a time, or merely counting was reported as loading whole rows — which described all seventeen of the deliberately converted endpoints as unconverted. Both now call `classify.select_kind`.

`table.json`, the endpoint table used in steps 3–5, and `meta-tables.json`, the TypeORM table metadata produced by `measure.js` in step 2, previously shared the name `table.json`. As a result, step 2 silently overwrote what was supposed to be the endpoint table before anything else could read it. They are now separate files.

### How to run

```bash
npm run build
npm run docs:inventory
```

`measure.js` needs a current `dist/` tree, so build first.

## Self-test

```bash
npm run docs:inventory:test
```

`selftest.py` runs the chain against a small fixture and checks the contracts between the steps: that every select category is recognised, that writes and locks are classified as writes, that the handler is read past a multi-line `@UseGuards(`, and that a newly appeared write site does not reach the published document. It needs neither `dist/` nor a database.

Every failure this pipeline has actually produced was silent — a renamed key, a shared file name, a filter keyed on fields that were never written. None of them crashed; they produced a complete document full of zeroes, or one carrying rows that did not belong in it. The self-test checks those contracts rather than the numbers of any given commit, so it stays valid as the code moves.

## Optional route verification

`verify_routes.py` is not part of the pipeline above. It compares the routes in `table.json` against `$INVENTORY_WORK/prod-norm.txt`, if present. The file must contain lines in the form `<METHOD> <path>`, taken from the application's `Mapped {...}` startup logs. It reads `table.json` rather than parsing the controllers a second time — a verifier that re-derives what it verifies confirms nothing.

## Hand-maintained tables

Some values cannot be derived and are kept as constants. A change to the code that affects them has to update them in the same pull request, or the generated document silently goes stale:

- `build_docs.py` → `CONVERTED` and `_before`: which endpoints were deliberately converted, their test state, and their column count before the conversion. **Converting an endpoint means adding it to both.**
- `endpoint_eff.py` → `MANUAL_NO_DB`: endpoints whose call graph ends at a target chosen at runtime, with the reason each reads nothing. The reason is rendered verbatim into `endpoints.md`; this is the only place it is maintained.
- `add_version_deprecated.py` → `NAMED`: maps `GetConfig().kycVersion` to its value, because the config is not loaded during a run.
- `classify.py` → `CALLER_SELECT`: endpoints whose projection depends on a field list in the request.
- `build_docs.py` → `ARRAY_SHARE`: what fraction of the `find` sites with no resolvable entity turned out to be array operations rather than repository reads, from a sample read in the source. It only feeds the order-of-magnitude caveat on the load-site total; re-sample it if that figure is ever leaned on for more.

## Origin and known rough edges

These scripts were developed outside this repository and checked in here for the first time. The backups contained several variants of individual steps with incompatible contracts. Those that had to be aligned:

- The measurement output field is now consistently named `cols`. One backup variant wrote `columns` instead, which silently left every measurement unlinked. `measure.js` now exits non-zero when nothing measures at all, so this class of failure cannot pass as a completed run again.
- The endpoint table is named `table.json`, while the TypeORM metadata tables are written to `meta-tables.json`. In one backup variant both used the same name and collided.
- `apply_drift.py` filtered new sites on `write` and `rawkind`, fields that only ever existed inside `build_docs.py` and are absent from `sites-measured.json` — so the filter matched nothing and would have inserted write statements, advisory locks and raw `INSERT`s into the published document. Both callers now share `classify.py`.
- The measurement built the default query and counted *that*, ignoring what the site actually selects. A converted read path was therefore reported at the width it was converted away from: `GET /buy/:id/history` measured 364 columns where its projection selects 12, and the document rendered "497 columns to 12" as "497 columns to 364" — presenting the conversion as a failure. `sites.py` now records the projection constant or the column count, and `measure.js` resolves the constant against `dist/` and counts `fields + guards`. `getCount()`/`getExists()` sites report no width at all, since no row is materialised. A projection that cannot be resolved reports an error rather than falling back to the default query, which would reintroduce the same wrong number silently.
- Columns named one at a time were counted per call within the chain up to the first `;`. That undercounts a query builder held in a variable and widened by later `qb.addSelect(...)` statements, and it misses a `.select(expr, 'alias')` whose first argument is a variable. Counting is now by distinct alias across the whole method, which also avoids double-counting a column added in both branches of an if/else.
- `endpoint_eff.py` decided "does this narrow its columns" with its own regex, recognising only a literal `.select([...])`. Every endpoint projecting through `PROJECTION.apply(...)`, naming its columns one at a time, or counting was classified as loading whole rows: a run produced 444 `whole rows` / 2 `projected` against the published 410 / 36, marked all seventeen converted endpoints `not yet`, and rendered the sentence "the other -15 were already projecting" without anything failing. It now calls `classify.select_kind`, and `build_docs.py` refuses to render if a `CONVERTED` endpoint does not come out projected.

Remaining properties worth knowing:

- **A query builder is measured at its root entity, not at its actual chain.** `measure.js` builds a bare query for the target entity; it never replays the site's `.leftJoinAndSelect(...)`, `.innerJoin(...)` or `.where(...)`. A site that joins and selects a relation through the builder API is therefore measured narrower than the SELECT it really emits. `sites.py` catches the common shape by marking such a site `projected, full join`, so the mechanism column stays honest — but the column count does not include the joined entity.
- **A query-builder chain is read for 1500 characters, and a longer one is truncated silently.** `CHAIN_WINDOW` bounds how far past `createQueryBuilder(` the chain is scanned. Every chain in the tree today resolves well inside it — the single one that exceeds it carries its `.select(...)` far earlier, so it classifies correctly. But a chain that put a `leftJoinAndSelect` past the boundary would be read as a plain field list, with nothing to signal the truncation. Widen the window or add a warning if such a chain ever appears.
- **The load-site total is an upper bound, not a count.** The scan matches `find` by name, and `find` on a repository is indistinguishable by name from `find` on an array. Where the target entity resolves, the distinction is settled; where it does not, the group holds both — currently some 343 rows, of which a sample suggests around 240 are array operations. The rendered document says so, in the headline and under *Measurements*; `endpoints.md` is unaffected, because the per-endpoint walk applies `is_db_find` and drops array calls. Narrowing the scan itself would change the published figures and needs its own validation, so the honest caveat comes first.

- The config stub in `measure.js`, implemented by the `config/config` branch of the `Module._load` patch, is intentional. Entities do not read the configuration in their decorators, while regular loading required roughly 300 environment variables without changing the measured metadata. Substitutions made by the generic catch branch are reported on stderr.
- `fix_handlers.py` used to re-derive the handler names after `make_table.py` had already read them, and the README kept it because a reading of the two files is not evidence. A differential run settled it: with and without the step, `table.json` comes out byte-identical, and the step reported zero corrections. It is gone.
- The renderer does not exactly reproduce the prose of the published documents. See "Do not simply regenerate" above.
