# Endpoint and load-site inventory

## What this is

`docs/endpoints.md` and `docs/load-sites.md` are generated inventories of every HTTP route and every database read site in this service, respectively.

## Do not simply regenerate

The published documents contain passages that were adjusted by hand after their initial generation: median figures, the "at most ... an upper bound" caveat, the "Known discrepancy" section, and English labels. The renderer, `build_docs.py`, does not produce these passages. Running `npm run docs:inventory` overwrites both documents completely and discards them.

A fresh run has been verified to produce the same inventory counts as the published documents: 537 handlers, 1,158 load sites, 251 files, and 299 entries marked internal. Its introductory prose does not match the published prose. Treat a fresh run as a data source, not as a replacement for the documents.

## Keeping the documents current

Use `apply_drift.py` to keep the published documents current after code changes. Run the same inventory pipeline twice: once on the commit from which the document was published and once on the current commit. `apply_drift.py` compares the two runs and applies only the following changes to the published `load-sites.md`:

- insert rows for new load sites;
- remove rows for load sites that no longer exist;
- update references when source line numbers move.

Column counts already present in the published document remain unchanged.

The script requires two environment variables:

- `INVENTORY_WORK`: a working directory containing the intermediate files from both runs. The script source shows the expected structure under `gen/old/` and `gen/new/`.
- `INVENTORY_REPO`: the path to a clone from which the script reads the published version with `git show <ref>:<path>`.

Invoke it as follows:

```bash
python3 apply_drift.py <pub_ref> <pub_path> <out_path>
```

These arguments are passed to `main(pub_ref, pub_path, out_path)`.

## Full pipeline

`scripts/inventory/run.sh` runs the following steps in order, writing intermediates under a temporary `INVENTORY_WORK` directory. The directory is printed on stdout and kept after the run for inspection.

1. `sites.py` extracts every load site from `src/` and writes `sites.json`.
2. `measure.js` measures SELECT column counts from TypeORM metadata in `dist/` and writes `sites-measured.json` and `meta-tables.json`. The latter contains per-table TypeORM metadata: column counts and entity names, one entry per table.
3. `make_table.py` extracts every route from the controllers and writes `table.json`, the endpoint table containing verb, path, controller, handler, file, and internal status.
4. `fix_handlers.py` re-derives handler names directly from the controllers and corrects `table.json` in place. This fixes cases where a multi-line decorator between the route decorator and the method was misread as the handler.
5. `add_version_deprecated.py` adds `version` and `deprecated` to each row of `table.json`, using the full decorator block (`@Version`, `deprecated: true`).
6. `endpoint_eff.py` joins the routes in `table.json` with the load sites they can reach and their over-fetch kinds, then writes `endpoint-eff.json`.
7. `build_docs.py` renders `endpoints.md` and `load-sites.md`, after which `run.sh` copies them into `docs/`.

`table.json`, the endpoint table used in steps 3–6, and `meta-tables.json`, the TypeORM table metadata produced by `measure.js` in step 2, previously shared the name `table.json`. As a result, step 2 silently overwrote what was supposed to be the endpoint table before anything else could read it. They are now separate files.

### How to run

```bash
npm run build
npm run docs:inventory
```

`measure.js` needs a current `dist/` tree, so build first. Before treating the generated files as replacements for the published documents, read "Do not simply regenerate" above.

## Optional route verification

`gen_endpoints.py` is not part of the pipeline above. It is a standalone verifier that must be invoked separately. It reads the routes from the controllers again and compares them against `$INVENTORY_WORK/prod-norm.txt`, if present. The file must contain lines in the form `<METHOD> <path>`, taken from the application's `Mapped {...}` startup logs. If the file is absent, the comparison is skipped and the script still completes successfully.

## Origin and known rough edges

These scripts were developed outside this repository and checked in here for the first time. The backups contain several variants of individual steps with incompatible contracts. Two of those contracts had to be aligned when the scripts were checked in:

- The measurement output field is now consistently named `cols`. One backup variant wrote `columns` instead, which silently left every measurement unlinked.
- The endpoint table is named `table.json`, while the TypeORM metadata tables are written to `meta-tables.json`. In one backup variant both used the same name and collided, as described in the `table.json`/`meta-tables.json` note above.

A review also found the following properties of the recovered scripts. They were deliberately left unchanged because changing their behavior could shift the generated figures and would need separate validation:

- `sites.py` swallows parse errors in a `relations` tree with `except Exception: pass`. The affected load site then enters the inventory without relations information instead of aborting the run or being marked.
- `make_table.py` records an unresolved handler as the placeholder `'?'`, using it as the fallback during handler and scope detection, instead of aborting.
- `add_version_deprecated.py` silently assigns `DEFAULT_VERSION` (`'1'`) and `deprecated = False` when no decorator match exists for a route, via the `(DEFAULT_VERSION, False)` fallback for route keys absent from `flags`, instead of marking the row.
- `fix_handlers.py` visibly overlaps with `make_table.py` in handler detection: both independently implement similar decorator and parenthesis skipping through `skip_trivia` and `skip_args`. Whether that step can be removed has not been established without a differential run, so it remains in the pipeline.
- The config stub in `measure.js`, implemented by the `config/config` branch of the `Module._load` patch, is intentional. Entities do not read the configuration in their decorators, while regular loading required roughly 300 environment variables without changing the measured metadata. Substitutions made by the generic catch branch are now additionally reported on stderr.

The renderer does not exactly match the version that produced the published documents. See "Do not simply regenerate" above.
