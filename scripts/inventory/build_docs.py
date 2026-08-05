#!/usr/bin/env python3
"""Rebuilds docs/endpoints.md and docs/load-sites.md."""
import json, os
from collections import Counter

import classify

SP = os.environ.get("INVENTORY_WORK")
if not SP:
    raise SystemExit("INVENTORY_WORK is not set - run this through scripts/inventory/run.sh")
SRC = os.environ.get("API_SRC")
if not SRC:
    raise SystemExit("API_SRC is not set - run this through scripts/inventory/run.sh")
with open(SP + '/endpoint-eff.json') as fh:
    eps = json.load(fh)
with open(SP + '/sites-measured.json') as fh:
    sites = json.load(fh)
if not eps or not sites:
    raise SystemExit("endpoint-eff.json or sites-measured.json is empty - an earlier stage "
                     "produced nothing, so there is nothing to render")


def access(e):
    if e['path'] in classify.CALLER_SELECT: return 'caller-defined'
    k = set(e['kinds'])
    if 'over' in k: return 'whole rows'
    if not k: return 'none'
    return 'projected'


def median(xs):
    return xs[len(xs) // 2]


def rel(path):
    return path.removeprefix('src/')


# ---------------- load sites: sort out write query builders ----------------
classify.annotate(SRC, sites)

loads = [s for s in sites if not s['write']]
kinds = Counter(s['kind'] for s in loads)
qb = [s for s in loads if s['kind'] == 'query-builder']
sel = Counter(s['select'] for s in qb)
writes = sum(1 for s in sites if s['write'])
qb_writes = sum(1 for s in sites if s['kind'] == 'query-builder' and s['write'])
# `find` sites whose target entity did not resolve. This group holds both repository reads and
# plain array `.find(...)` calls — the scan matches by name, and the two are indistinguishable
# that way. It is what makes the total an upper bound rather than a count.
unresolved_find = sum(1 for s in loads if s['kind'] == 'find' and not s['entity'])
# Share of that group that turned out to be array operations when read in the source. A sample
# of 30 rows came out at 21 to 9; hand-maintained, like the tables further down — re-sample it
# if the figure is ever leaned on for more than an order of magnitude.
ARRAY_SHARE = 0.7

meas = [s for s in loads if s.get('cols')]
exact = [s for s in meas if s['relations']]
lower = [s for s in meas if not s['relations']]
cols_sorted = sorted(s['cols'] for s in meas)
if not loads or not cols_sorted:
    raise SystemExit(f"{len(loads)} load sites, {len(cols_sorted)} of them measured - without "
                     "measurements the document would state a width of zero everywhere")

# Break down raw SQL: lock, write, or a genuine read
raw_lock = sum(1 for x in sites if x['rawkind'] == 'lock')
raw_write = sum(1 for x in sites if x['rawkind'] == 'write')
raw_read = sum(1 for x in sites if x['rawkind'] == 'read')

# Column counts before the conversion, taken from the survey of the starting state, so the
# text can name the effect rather than assert it. Hand-maintained alongside CONVERTED below:
# a PR that converts an endpoint adds it to both.
_before = {('GET', '/user/profile'): 253, ('GET', '/buy/:id/history'): 497,
           ('GET', '/swap/:id/history'): 509, ('GET', '/sell/:id/history'): 470,
           ('GET', '/support/issue/:id/data'): 951, ('GET', '/support/issue'): 450,
           ('GET', '/support/issue/:id'): 450,
           ('GET', '/kyc/users'): 328, ('GET', '/kyc/:id/documents'): 328,
           ('GET', '/custody/order'): 19,
           ('GET', '/support/issue/list'): 16, ('GET', '/realunit/support/list'): 16,
           ('GET', '/dashboard/accounting/ledger/suspense'): 11,
           ('GET', '/liquidityManagement/pipeline/:id/status'): 112,
           ('PUT', '/paymentLink/:id/pos'): 513, ('POST', '/user/apiKey/CT'): 253,
           ('GET', '/user'): 351}
_after = {}

_proj_cols = sorted(x['cols'] for x in sites
                    if x.get('select') == classify.SEL_NAMED_COLUMNS and x.get('cols'))
proj_median = median(_proj_cols) if _proj_cols else 0

# ---------------- 1. Endpoints ----------------
total = len(eps)
internal = sum(1 for e in eps if e['internal'])
files = len({e['file'] for e in eps})
acc = Counter(access(e) for e in eps)
ver = Counter(e['version'] for e in eps)
# Converted endpoints with their test state. An entry means: a spec file exists that checks
# exactly this endpoint against the four levels. Without an entry a projection counts as
# untested - that is the point of the Tests column. Hand-maintained together with _before.
CONVERTED = {
    ('GET', '/user/profile'): '4/4',
    ('GET', '/buy/:id/history'): '4/4',
    ('GET', '/swap/:id/history'): '4/4',
    ('GET', '/sell/:id/history'): '4/4',
    ('GET', '/support/issue/:id/data'): '4/4',
    ('GET', '/support/issue'): '4/4',
    ('GET', '/support/issue/:id'): '4/4',
    ('GET', '/kyc/users'): '4/4',
    ('GET', '/kyc/:id/documents'): '4/4',
    ('GET', '/custody/order'): '4/4',
    ('GET', '/support/issue/list'): '4/4',
    ('GET', '/realunit/support/list'): '4/4',
    ('GET', '/dashboard/accounting/ledger/suspense'): '4/4',
    ('GET', '/liquidityManagement/pipeline/:id/status'): '4/4',
    ('PUT', '/paymentLink/:id/pos'): '4/4',
    ('POST', '/user/apiKey/CT'): '4/4',
    ('GET', '/user'): '4/4',
}


def tests(e):
    """State against the four test levels. `n/a` = the definition does not apply."""
    a = access(e)
    if a in ('none', 'caller-defined'): return 'n/a'
    if a == 'whole rows': return 'not yet'
    if e['path'] == '/gs/debug': return 'n/a'      # field list comes from the caller
    # `/user` exists twice: the v1 handler passes a fiat through and was not converted, the v2
    # one was. The path alone does not tell them apart, so the version decides.
    if e['path'] == '/user' and e.get('version') != '2': return '0/4'
    known = CONVERTED.get((e['verb'], e['path']))
    if known: return known
    # Projected, but without its own spec against the four levels: exactly the state this
    # document records as unfinished.
    return '0/4'


_after.update({(e['verb'], e['path']): e['maxcol'] for e in eps
               if (e['verb'], e['path']) in CONVERTED})

whole = [e for e in eps if access(e) == 'whole rows']
mc = sorted((e['maxcol'] for e in whole if e['maxcol']), reverse=True)
if whole and not mc:
    raise SystemExit("no endpoint in the `whole rows` group carries a measured column count")
# Every converted endpoint must come out projected, or the prose below subtracts a bigger
# number from a smaller one and states a negative count. That happened: a classifier that only
# recognised a literal `.select([` scored all 17 of them as loading whole rows, and the
# document read "the other -15 were already projecting" without anything failing.
misclassified = [k for k in CONVERTED
                 if k not in {(e['verb'], e['path']) for e in eps if access(e) == 'projected'}]
if misclassified:
    for v, p in misclassified:
        print(f"  MISCLASSIFIED {v:6s} {p}")
    raise SystemExit(f"{len(misclassified)} of {len(CONVERTED)} endpoints listed as converted are "
                     "not classified as projected - the select detection and the CONVERTED table "
                     "disagree, so one of them is wrong")

dep_total = sum(1 for e in eps if e['deprecated'])
dep_acc = Counter(access(e) for e in eps if e['deprecated'])
incomplete = sum(1 for e in eps if not e['complete'])
manual_n = sum(1 for e in eps if e.get('manual'))
nomeas_list = [e for e in eps if access(e) == 'whole rows' and not e['maxcol']]
nomeas = len(nomeas_list)

o = ["# HTTP endpoints", "",
     f"Every HTTP endpoint this service exposes: **{total} handlers** across {files} controller " +
     f"files. {internal} are marked `@ApiExcludeEndpoint` and do not appear in the public Swagger " +
     "schema.", "",
     "## Columns", "",
     "| Column | Meaning |",
     "| ------ | ------- |",
     "| **Ver** | API version in the URL. `1` is the default and needs no decorator; `2` comes from " +
     "`@Controller({ version: [...] })`; `neutral` marks `@Version(VERSION_NEUTRAL)`, which is served " +
     "without a version prefix. Six paths exist twice under different versions — an older, deprecated " +
     "handler and its replacement — so the version is what makes a row unique. |",
     "| **Dep** | `yes` when the handler carries `@ApiOperation({ deprecated: true })` |",
     "| **Swagger** | `public` — in the Swagger schema; `hidden` — carries `@ApiExcludeEndpoint` |",
     "| **Data access** | What the endpoint reads, taken over **all** load sites it can reach — a " +
     "permission check, a lookup and the actual query all count. `whole rows` — at least one of them " +
     "fetches every column of an entity; `projected` — every read names the fields it needs; " +
     "`caller-defined` — the field list comes from the request, and without one every column is " +
     "loaded; `none` — no read at all (external services, in-memory caches, files, pure write paths). |",
     "| **Max cols** | Widest single query the endpoint can trigger, measured against the real entity " +
     "metadata. `—` means no measurable site, not zero. |",
     "| **Tests** | State against the four levels in " +
     "[read-path-projections.md](read-path-projections.md#test-definition). `n/a` — the definition " +
     "does not apply (the endpoint reads nothing, or its field list comes from the caller); " +
     "`not yet` — the endpoint has not been converted, so nothing can be missing from it yet; " +
     "`0/4` to `4/4` — levels satisfied. **A converted endpoint counts as done only at `4/4`.** |",
     "| **Spec** | `yes` when some spec file names this controller and calls this handler. A weak " +
     "signal and a lower bound — it says a test touches the endpoint, not that it covers it, and it " +
     "misses specs that drive a route over HTTP without naming the handler. |",
     "", "## The target state", "",
     "Every read path in this service is to select the fields it returns, and nothing more. This " +
     "document is the work list for getting there and the record of where we stand.", "",
     "Two rules follow from that, and both are binding:", "",
     "1. **An endpoint counts as converted only when its tests reach `4/4`** against the four levels " +
     "in [read-path-projections.md](read-path-projections.md#test-definition). A projection without " +
     "them is worse than no projection: a forgotten field does not crash, it returns a wrong value " +
     "with a 200, and in a service moving money that can run for weeks unnoticed. Anything short of " +
     "`4/4` is unfinished work, not a partial success.",
     "2. **The state of every endpoint is recorded here**, in the `Tests` column, and kept in sync " +
     "with the code in the same pull request that changes it. An undocumented conversion is " +
     "indistinguishable from one that was never tested.", "",
     f"Today {acc['projected'] + acc['caller-defined']} endpoints read only what they return and " +
     f"{acc['whole rows']} do not, so the column reads `not yet` almost everywhere. That is the " +
     "point of recording it: the number is the distance to the target.", "",
     "## What the numbers say", "",
     "| Data access | Endpoints | Share |",
     "| ----------- | --------: | ----: |",
     f"| `whole rows` | {acc['whole rows']} | {100*acc['whole rows']/total:.0f} % |",
     f"| `none` | {acc['none']} | {100*acc['none']/total:.0f} % |",
     f"| `projected` | {acc['projected']} | {100*acc['projected']/total:.0f} % |",
     f"| `caller-defined` | {acc['caller-defined']} | {100*acc['caller-defined']/total:.0f} % |",
     "",
     f"Of the {acc['projected']} that read only what they return, {len(CONVERTED)} were converted " +
     f"deliberately and carry tests on all four levels: " + ", ".join(
         f"`{v} {p}` ({_before.get((v, p), '?')} columns to {_after.get((v, p), '?')})"
         for (v, p) in CONVERTED) + ". " +
     f"The other {acc['projected'] - len(CONVERTED)} were already projecting — mostly counts, " +
     "maxima and id lookups written with a query builder, which name their columns one at a time " +
     "rather than as a list. They are not covered by the tests below, which is why their `Tests` " +
     "column reads `0/4` rather than `n/a`: a projection without those tests is exactly the state " +
     "this document warns about, whether it was written today or three years ago. " +
     "`POST /gs/db` and `POST /gs/db/custom` project only when the caller sends a field " +
     "list — `request.select(query.select)` — and load the full table otherwise.", "",
     f"Among the {acc['whole rows']} that fetch whole rows, the widest query they can trigger is " +
     f"**{median(mc)} columns** at the median; {sum(1 for x in mc if x > 100)} exceed 100, " +
     f"{sum(1 for x in mc if x > 500)} exceed 500 and {sum(1 for x in mc if x > 1000)} exceed 1000. " +
     f"Postgres refuses a statement with more than 1664 columns, so a query near that number is one " +
     f"added column away from failing outright.", "",
     "### How to read this column, and how not to", "",
     "`Data access` is a statement about the **union** of everything an endpoint touches, not about " +
     "one designated data path. An endpoint marked `whole rows` may well answer from raw SQL and " +
     "still be marked, because a permission check on the way loads a full `UserData` row. That is " +
     "deliberate: the question the column answers is *does this endpoint load more than it needs*, " +
     "and for that any one offending site is enough. It does **not** say where the bulk of the work " +
     "happens — [load-sites.md](load-sites.md) does, per site and with measured column counts.", "",
     "### Deprecation", "",
     f"{dep_total} handlers carry `@ApiOperation({{ deprecated: true }})`: {dep_acc['whole rows']} of " +
     f"them fetch whole rows, {dep_acc['none']} read nothing. They are what the duplicated paths are " +
     "about — an older handler and its replacement served side by side under different versions. Note " +
     "that deprecation does not follow the version: `GET /kyc/countries` is marked on **both** the v1 " +
     "and the v2 handler.", "",
     "### Limits of this classification", "",
     "Stated exactly, so the numbers can be checked rather than believed:", "",
     f"- **{incomplete} of {total} endpoints rest on a call graph that is not fully resolved** — a " +
     "target chosen at runtime, a method reached through inheritance, an entity manager handed into a " +
     "transaction callback. This does not weaken the `whole rows` group: an unresolved edge can only " +
     f"add load sites, never remove one, so {acc['whole rows']} is a lower bound.",
     f"- All {acc['none']} endpoints marked `none` are the opposite case: their graph resolved " +
     f"completely, or the remaining target was read in the source ({manual_n} of them, listed below). " +
     "None of them rests on an unresolved edge.",
     f"- The {acc['projected']} `projected` and {acc['caller-defined']} `caller-defined` endpoints do " +
     "each carry an unresolved edge — a call through the entity manager inside a transaction " +
     "callback. Their reads were read in the source, but the classification is not proven exhaustive " +
     "the way the `none` group is.",
     f"- {nomeas} endpoints in the `whole rows` group have no measured column count and show `—`: "
     + ", ".join(f"`{e['verb']} {e['path']}`" for e in nomeas_list) + ". The classification holds; " +
     "only the width is unknown.", "",
     "### Two controller classes may share a name", "",
     "`KycController`, `KycClientController` and `KycService` each exist twice, in different " +
     "subdomains: the deprecated v1 generation under `generic/user/models/kyc/` and the current one " +
     "under `generic/kyc/`. Rows are therefore not identified by the handler column alone — the file " +
     "column is what separates them. The same holds for the 57 strategy classes that repeat a name " +
     "once per family (`BitcoinStrategy` exists eight times), though none of those serves a route.", "",
     "### Endpoints resolved by reading the source", "",
     f"For {manual_n} endpoints the call graph ends at a target chosen at runtime. Each was read in " +
     "the source and recorded here rather than left unknown, so the judgement is visible and can be " +
     "challenged:", "",
     "| Endpoint | Why it reads nothing |",
     "| -------- | -------------------- |"]
# The reason travels in endpoint-eff.json, written by endpoint_eff.py. It used to be repeated
# here in a second table keyed the same way, which turned an addition on one side into a
# KeyError on the other.
o += [f"| `{e['verb']} {e['path']}` | {e['manual']} |"
      for e in sorted(eps, key=lambda r: r['path']) if e.get('manual')]
o += ["",
     "[read-path-projections.md](read-path-projections.md) explains the background, the criteria for " +
     "converting an endpoint, and how the result is tested.", "",
     "## How the values are produced", "",
     "- **Endpoints** — from the routing decorators in `src/**/*.controller.ts`, each attributed to " +
     "the `@Controller` scope preceding it. Decorators between the route and the method are skipped " +
     "by counting parentheses, so a multi-line `@UseGuards(` cannot be mistaken for the handler. " +
     "Cross-checked in both directions against the routes the framework registers at startup: all " +
     "526 distinct method/path pairs match, with no entry left over on either side.",
     "- **Ver** — from `@Version` on the handler, otherwise from the `@Controller` scope, otherwise " +
     "the configured default. Note that the version follows the class, not the folder: the " +
     "controllers under `generic/kyc/` are not uniformly v2 — `KycAdminController` carries no " +
     "version decorator and is therefore served under the default.",
     "- **Data access** — the union over the call graph, following injected fields, locally " +
     "constructed repositories and multi-line call chains. `find*` pulls in eager relations, " +
     "`createQueryBuilder` does not. A query narrows its column list through `.select([...])`, " +
     "through a `ReadProjection` applied with `PROJECTION.apply(...)`, by naming columns one at a " +
     "time as `.select('alias.column')`, or by counting with `getCount()`/`getExists()`; " +
     "`.select('alias')` names the root alias and narrows nothing. `.update()/.delete()/.insert()` " +
     "are writes that load nothing.",
     "- **Max cols** — measured, not estimated. A query that narrows is counted at what it " +
     "selects: the field list of its projection, or the columns it names. Everything else is " +
     "built from the real entity metadata and its SELECT list counted.", "",
     "## Known discrepancy", "",
     "`POST /paymentLink/integrations/kucoin/webhook/cancel` appears in the source but is **not " +
     "registered at runtime**: its handler in `c2b-payment-link.controller.ts` carries two `@Post` " +
     "decorators, and the framework stores a single path per handler, so only `.../webhook/success` " +
     "takes effect. Listed below for completeness and marked accordingly.", "",
     "## Endpoints", "",
     "| Method | Ver | Dep | Path | Swagger | Data access | Max cols | Tests | Spec | Handler | File |",
     "| ------ | --- | --- | ---- | ------- | ----------- | -------: | ----- | ---- | ------- | ---- |"]
for e in sorted(eps, key=lambda r: (r['path'], r['verb'], r['version'])):
    note = ' ⚠️' if e['path'] == '/paymentLink/integrations/kucoin/webhook/cancel' else ''
    o.append(f"| {e['verb']} | {e['version']} | {'yes' if e['deprecated'] else ''} | " +
             f"`{e['path']}`{note} | " +
             f"{'hidden' if e['internal'] else 'public'} | {access(e)} | " +
             f"{e['maxcol'] or '—'} | {tests(e)} | {'yes' if e['spec'] else ''} | " +
             f"`{e['controller']}.{e['handler']}` | " +
             f"`{rel(e['file'])}` |")
o += ["", "⚠️ = not registered at runtime, see *Known discrepancy* above."]
with open(SP + '/endpoints.md', 'w') as fh:
    fh.write("\n".join(o) + "\n")

# ---------------- 2. Load sites ----------------
t = ["# Database load sites", "",
     f"Every place in the code that reads from the database: **at most {len(loads)} load sites** " +
     "across " +
     f"{len({s['file'] for s in loads})} files — an upper bound, for the reason given under " +
     "*Measurements*.", "",
     "This is the level at which the statement is unambiguous. An endpoint reaches several load " +
     "sites — a permission check, a lookup, the actual query — so asking whether *an endpoint* loads " +
     "efficiently has no single answer. Asking it of a load site does. " +
     "[endpoints.md](endpoints.md) carries the per-endpoint summary derived from these sites.", "",
     "## What the mechanism means", "",
     "| Mechanism | Sites | Eager relations | Columns selected |",
     "| --------- | ----: | --------------- | ---------------- |",
     f"| `find` family | {kinds['find']} | **applied** — expanded recursively | all columns of the " +
     "entity plus every eager relation |",
     f"| `createQueryBuilder` | {kinds['query-builder']} | not applied | all columns of the root " +
     "entity, unless `.select([...])` narrows it |",
     f"| raw SQL | {kinds['raw-sql']} | not applied | whatever the statement lists |",
     "",
     f"Statements that load nothing are excluded from the count: {qb_writes} `createQueryBuilder` " +
     f"calls carrying `.update()`, {raw_lock} advisory locks (`SELECT pg_advisory_xact_lock(...)`, " +
     f"which return no rows) and {raw_write} raw `INSERT`. Each of the {kinds['raw-sql']} raw reads " +
     "that remain names its columns.", "",
     "Among the query builders, the field list is what decides whether anything is actually saved:",
     "",
     "| | Sites |", "| --- | ---: |",
     f"| `.select([...])` or `PROJECTION.apply(...)` — an explicit field list | **{sel.get(classify.SEL_FIELD_LIST, 0)}** |",
     f"| `.select('alias.column')` — names columns one by one | **{sel.get(classify.SEL_NAMED_COLUMNS, 0)}** |",
     f"| `.select('alias')` — selects the root alias, **loads every column** | {sel.get(classify.SEL_ALIAS_ONLY, 0)} |",
     f"| no `select` at all — loads every column | {sel.get(classify.SEL_NO_SELECT, 0)} |",
     f"| `getCount()` or `getExists()` — the select list is discarded, **no row is materialised** | " +
     f"{sel.get(classify.SEL_COUNT_ONLY, 0)} |",
     f"| projects, but a `leftJoinAndSelect` loads a relation whole | {sel.get(classify.SEL_PROJECTED_FULL_JOIN, 0)} |",
     "",
     "`.select('alias')` is the trap: it reads like a projection but the argument is the entity " +
     "alias, not a field list. Such a query still loads every column of the root entity — it merely " +
     "avoids the eager relations. `.select('alias.column')` is the opposite case and easy to lump in " +
     "with it: it names a column and does narrow the query. The distinction is the presence of a dot " +
     "in the argument, and it matters — the sites that name columns this way select " +
     f"{proj_median} column{'' if proj_median == 1 else 's'} at the median, against {kinds['find']} `find` calls that select every " +
     "one. Most of them are counts, maxima and id lookups rather than response payloads, which is why " +
     "the endpoint summary still reads the way it does.", "",
     "## Measurements", "",
     "Columns were measured against the real entity metadata by building the query and counting its " +
     f"SELECT list — {len(meas)} of {len(loads)} sites.", "",
     f"- **{len(exact)} are exact**: the `relations` tree is written at the call site.",
     f"- **{len(lower)} are lower bounds**: the tree arrives as a parameter, so only the base query " +
     "is visible here. `transaction.service.ts` is the clearest case — its callers pass trees " +
     "reaching well over a thousand columns.",
     f"- {len(loads) - len(meas)} could not be measured: no resolvable target entity, or raw SQL.",
     "",
     "**That last group is also why the total is an upper bound.** The collection matches `find` " +
     "by name, and `find` on a repository is indistinguishable by name from `find` on an array. " +
     "Where the target entity resolved, the distinction is settled; where it did not, the group " +
     f"holds both. That group holds {unresolved_find} rows; a sample read in the source came out " +
     f"at roughly {int(ARRAY_SHARE * 100)} % array operations, so on the order of " +
     f"{round(unresolved_find * ARRAY_SHARE / 10) * 10} of them are not database reads at all, " +
     f"and the true count is nearer {round((len(loads) - unresolved_find * ARRAY_SHARE) / 50) * 50}.",
     "",
     f"Median across measured sites: **{median(cols_sorted)} columns**. " +
     f"{len([c for c in cols_sorted if c > 1000])} sites exceed 1000, " +
     f"{len([c for c in cols_sorted if c > 500])} exceed 500, " +
     f"{len([c for c in cols_sorted if c > 100])} exceed 100.", "",
     "Postgres refuses a statement with more than 1664 columns, so a query near that number is one " +
     "added column away from failing outright, whatever the column and wherever it is added.", "",
     "## Load sites", "",
     "Sorted by measured columns, largest first. `—` means not measurable, not zero.", "",
     "| Columns | Joins | Mechanism | Entity | Location | Method |",
     "| ------: | ----: | --------- | ------ | -------- | ------ |"]
for s in sorted(loads, key=lambda x: (-(x.get('cols') or 0), x['file'], x['line'])):
    mech = s['kind'] + (f" ({s['select']})" if s.get('select') else '')
    where = f"`{s['cls']}.{s['method']}`" if s['cls'] and s['method'] else '—'
    t.append(f"| {s.get('cols') or '—'} | {s.get('joins') if s.get('cols') else '—'} | {mech} | " +
             f"`{s['entity'] or '—'}` | `{rel(s['file'])}:{s['line']}` | " +
             f"{where} |")
with open(SP + '/load-sites.md', 'w') as fh:
    fh.write("\n".join(t) + "\n")

print(f"endpoints.md {len(o)} lines | load-sites.md {len(t)} lines")
print(f"data access: {dict(acc)} | versions: {dict(ver)}")
print(f"load sites: {len(loads)} ({writes} write query builders removed) | " +
      f"find {kinds['find']} / QB {kinds['query-builder']} / SQL {kinds['raw-sql']} | " +
      f"field list {sel.get(classify.SEL_FIELD_LIST, 0)}")
