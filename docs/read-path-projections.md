# Read-path projections

What the load-site inventory shows, what we intend to do about it, and how the result is to be
tested.

## The goal

**Every read path in this service selects the fields it needs, and nothing more.** "Needs" is wider than "returns" and the difference is where projections go wrong: a field read to decide what to answer or whether to refuse, a field a branch depends on, and a field a column-scoped write derives its value from all belong in the projection, though none of them appears in the response. That is the
target state, not an aspiration for the parts that happen to be convenient — the endpoint inventory
in [endpoints.md](endpoints.md) is the work list, and its `Tests` column is the record of how far
we have got.

**Every converted endpoint must reach 100% coverage under the four levels defined below.** An
endpoint is not converted at `3/4`; it is unfinished. The reason is in *The risk this must guard
against*: a projection that drops a field does not fail loudly, it answers 200 with a wrong value.
Converting without the tests replaces a slow query with a silent defect, which is the worse of the
two.

**That coverage is documented per endpoint in this repository**, in the `Tests` column of
[endpoints.md](endpoints.md), and updated in the same pull request that changes the code. A
conversion whose coverage is not recorded cannot be told apart from one that was never tested, and
is treated as the latter.

## The problem

This service loads far more data than it returns. Measured against the real entity metadata:

- The whole database schema has **1,736 columns across 99 tables**.
- `PUT /v1/transaction/:id/invoice` selected **1,664 of them** — 96% of the entire schema — to
  render a PDF containing a handful of values. That is exactly Postgres' limit of 1,664 columns per
  statement, so the query was one added column away from failing outright, whatever the column and
  wherever it was added.
- Of the 534 endpoints, **398 reach at least one load site that fetches whole rows**; 98 read
  nothing at all, and **36 read only the fields they return**. The widest query a fetching endpoint
  can trigger is 308 columns at the median, and 19 of them exceed 1,000.

The column limit was the symptom, not the cause. Loading a thousand columns to return one is
equally wasteful under a limit of 4,096 — it simply would not have failed yet.

### Where it comes from

Two properties combine:

**Eager relations.** 95 relations in this repo are declared `eager: true`. TypeORM expands them
recursively, so a plain `findOne()` on `UserData` already selects **253 columns across 8 joins**,
and one on `LimitRequest` **434 across 15** — before any `relations` option is passed. The
decision what to load therefore lives in the entity definition, not at the call site, and no call
site can see what it triggers.

**No read model.** Of the 1,105 load sites in this repository, **113** load less than a whole row:
105 query builders that name their columns, three that end in `getCount()` or `getExists()` and
materialise none, and the five raw statements. The other 992 request whole rows — 957 through the
`find` family, and of the 143 query builders, 17 pass the root alias to `.select(...)`, which reads
like a projection but is not, 17 pass no select at all, and one projects its root but pulls a
relation in whole. The same entities serve persistence, business logic and pure output paths such
as invoices, receipts, history and exports — which need fields, not objects.

Read the first number carefully, because an earlier revision of this document got it wrong. The 87
query builders that name columns one at a time are almost entirely counts, maxima and id lookups —
`.select('userData.id', 'id')`, `.select('COUNT(*)', 'count')` and the like — and they select **one
column at the median**. They are projections, and they were miscounted as full loads because the
classification recognised only the array form `.select([...])` and read every string argument as the
bare root alias. The rule that holds: a bare identifier is the root alias and loads everything;
anything else — a column or an expression — narrows the query. Correcting it moved 15 endpoints out
of the `whole rows` group. What it does not do is change the picture: a
`COUNT(*)` that was always narrow is not a read path that was converted, and the response payloads —
history, profile, invoices, exports — are still served by `find`.

Two further shapes were counted as full loads for the same kind of reason, and both are decided by
something the select list does not show:

- **The terminal call can discard the select list.** `getCount()` and `getExists()` replace it with
  `COUNT(…)` and `SELECT 1`, so a chain ending in either materialises no row whatever precedes it.
  Three load sites do this, and `GET /support/kycFileStats` was listed as fetching 99 columns
  because of one of them.
- **The select argument can be a variable.** `.select(bucketExpr, 'bucket')` names an expression as
  surely as a literal does; whether it narrows depends on what the variable holds, which has to be
  resolved in the enclosing method. Four load sites do this — three of them in the two
  caller-defined `/gs/db` endpoints, the fourth an aggregate that was reported as a full load.

Neither changes the picture either, and both are now part of the classification.

## Vocabulary

| Term | Meaning here |
| ---- | ------------ |
| **Overfetching** | Loading or transferring more data than the result needs. The umbrella term for this whole topic. |
| **Eager loading** | Automatically loading related entities, recursively. The opposite is lazy loading. |
| **Projection** | Selecting only the columns the result needs. The countermeasure. |
| **Read path** | A load site whose result is only read and rendered, never persisted. Stated per load site, not per endpoint: an endpoint may write one entity and read another, and the criteria below are applied to each of its load sites separately. |
| **Write path** | An endpoint that persists a loaded entity — it needs the complete object. |
| **Read model** | A separate model optimised for reading. Introducing projections for read paths is a small step towards one. |

Note that eager relations apply to the `find*` family, **not** to `createQueryBuilder` and not to
raw SQL. [load-sites.md](load-sites.md) records that mechanism for each load site,
together with the measured column count.

[endpoints.md](endpoints.md) summarises this per endpoint, as the union over every load site the
endpoint can reach. That column answers one question only — *does this endpoint load more than it
needs* — and any single offending site is enough to answer yes. It deliberately says nothing about
where the bulk of the work happens: an endpoint whose own query is raw SQL is still marked when a
permission check on the way loads a full row. For that question the load site is the level at
which the statement is unambiguous, which is why both documents exist.

## What we intend to change

Read paths select the fields they need — including the ones they read without returning — via a
query builder with an explicit field list. Write
paths stay as they are — they need complete entities.

Note that `select` inside `find` options is **not** sufficient: it narrows the root entity but
still pulls in the eager relations. Measured on `Transaction`: `find` selects 98 columns over 2
joins, `find` with a three-field `select` still 81 over 2, a query builder with three fields
selects 3 over none.

### When an endpoint qualifies

All of the following must hold:

1. **No write to the entity in question** anywhere in the call chain — no `save`, `update`,
   `delete` or `remove` on its repository or on the entity manager. The endpoint may write *other*
   entities; the criterion applies per load site.
   The hazard is saving a partially loaded row back, where the unselected columns are undefined and
   would be written as null. A column-scoped `update(id, …)` cannot do that — it sends only the
   columns named in the call — so it does not disqualify a read path. **A value the write derives
   from what was read is the case to watch**: `PUT /paymentLink/:id/pos` merges into the existing
   configuration, so a `config` the query failed to load would be a configuration silently reset.
   That does not exclude the endpoint; it obliges the projection to carry every field the written
   value derives from, and the specs to assert them directly.
2. **The entity is not handed to code whose use of it is unknown** — an event handler, a generic
   service, a queue.
3. **All result-relevant fields are statically determinable.** Ruled out by dynamic field access
   (`this[variable]`) unless the field list resolves to a constant. Two such getters exist, both in
   `user-data.entity.ts`.
4. **The endpoint returns a DTO**, not an entity and not a binary stream. When an entity is
   returned, the required field set is not defined by a contract and cannot be narrowed safely.
5. **The tests below pass.**

The first four are pre-filters; the fifth decides.

## What qualifies, measured

The pre-filters above are stated as criteria; this is what they select when applied to the
inventory. Every step is mechanical except the last two, which were read in the source.

| | before | now |
| --- | ---: | ---: |
| fetch whole rows | 415 | 398 |
| … every load site they reach can be narrowed at all | 37 | 29 |
| … no write to the loaded entity, and the response is a structured value | 16 | 8 |
| … and no DTO field passes an entity through | **9** | **1** |

The step that decides the size of this work is the first one, and it has a single cause: at 321 of
the 484 load sites involved, **the loaded entity leaves the loading method**.
`UserDataService.getUserData` returns `Promise<UserData>` to 113 different endpoints. What fields
are needed is decided by each caller, not at the load site, so a projection there would be guessed
rather than derived — and the union over 113 callers is the whole entity anyway. Splitting those
hubs into per-caller reads is a separate piece of work with a different shape. It is not assumed
here, and the numbers above do not depend on whether it happens.

The last step removes seven endpoints whose DTO has a field typed as an entity — `currency: Fiat`,
`targetAsset: Asset`. The response then contains every column of that entity, so a projection would
have to list them all and would save nothing. Narrowing those means changing the contract, which is
a different decision.

**One endpoint remains, and it is excluded by the second criterion rather than by the first four.**
`POST /support/issue/:id/message` hands the message it creates — carrying the issue and the account
behind it — to the notification service. What that code reads is not determinable at the load site,
so a field list here would be guessed.

The filters are deliberately conservative and reject endpoints that can in fact be converted: an
endpoint fails the first step if *any* load site it reaches leaks, including one on a branch that
has nothing to do with the response. Nine of the seventeen conversions recorded in
[endpoints.md](endpoints.md) were found that way — by reading the endpoint after the filter had
rejected it. The counts above are therefore a lower bound on what is possible, not a ceiling.

Two of those seventeen are conversions the first criterion excluded as written. It rejects an
endpoint that writes the entity it loaded, and the hazard it names is saving a partially loaded row
back — the unselected columns are undefined on the entity and would be written as null.
`PUT /paymentLink/:id/pos` and `POST /user/apiKey/CT` write through `update(id, …)`, which sends
only the columns named in the call, so a projected read cannot blank anything. What the criterion
does have to keep excluding is a value the write *derives* from what was read: the point-of-sale
write merges into the existing configuration, so `config` is part of that projection and is
asserted directly.

## The risk this must guard against

A missing field does not crash. It is simply absent, getters compute with it anyway, and the
endpoint answers 200 with a wrong value.

The concrete case, from the code that was already fixed once:

```typescript
get requiredInvoiceFields(): string[] {
  return ['accountType'].concat(this.isPersonalAccount ? ['firstname','surname'] : ['organizationName']);
}
get isInvoiceDataComplete(): boolean {
  return this.requiredInvoiceFields.every((f) => this[f]);
}
```

Leave `surname` out of the projection and `isInvoiceDataComplete` returns `false` where the full
load returns `true`. The invoice is refused with "user data is not complete" although the data is
complete. No error, no log entry.

This service carries **234 such getters across 50 of its 112 entities**. In an application moving
money, a silent wrong value is worse than a crash: a statement that exceeds the column limit fails
loudly and is found at once, while a wrong value can run for weeks.

## Test definition

All four levels must pass for an endpoint to count as converted. `endpoints.md` records the state
per endpoint as `0/4` through `4/4`; only `4/4` is done.

### Which endpoints these apply to

To any load site that carries an explicit field list — that is where a forgotten field silently
yields an empty value.

A hundred and five sites carry a field list. The table below covers the six that were known when this
document was written — one query builder and five raw statements — and none of them was converted,
so it is unchanged. Another 87 are the query builders that name columns one at a time; they are
not covered by these levels either, which is what their endpoints' `0/4` in
[endpoints.md](endpoints.md) records. The remaining 17 belong to the endpoints converted so far and
are covered on all four. Sites a conversion adds are recorded there too, where only
`4/4` counts as done.

| Site | Form | Runs in a test | Column list asserted | Real database |
| ---- | ---- | -------------- | -------------------- | ------------- |
| `log.repository.ts:699` — `getFinancialLogValidityChangeSet` | `.select(['log.id', 'log.valid'])` | **no** | no | no |
| `log.repository.ts:341` — `getFinancialLogAssetPrices` | raw SQL, columns listed | **no** | no | no |
| `log.repository.ts:511` — `getFinancialLogSummariesFull` | raw SQL, columns listed | yes | yes | no |
| `log.repository.ts:664` — `getFinancialLogSummariesChartOnly` | raw SQL, columns listed | yes | yes | no |
| `virtual-iban.service.ts:769` — `hasOrderedOwnershipPath` | raw SQL, columns listed | **no** | no | no |
| `gs.service.ts:337` — `executeDebugQuery` | raw SQL, list supplied by the caller | yes | yes | no |

Read that column by column, because the three answers mean different things.

**Runs in a test.** Three of the six are never executed. `getFinancialLogValidityChangeSet` is
replaced by `jest.spyOn(logRepo, …).mockResolvedValue([…])` at all nine of its appearances, so the
projection line itself never runs. `getFinancialLogAssetPrices` is stood in for by a hand-written
fake that reimplements the filtering in TypeScript. `hasOrderedOwnershipPath` appears in no spec at
all. The two summary queries do run, through the `getFinancialLogSummaries` dispatcher, which the
repository spec calls 31 times.

**Column list asserted.** Where a query runs, `query` is spied and the generated SQL inspected —
an `expect(sql).toContain(...)` per projected column, and for the chart-only path an assertion
that `message` never appears in the statement at all.
Dropping a column from those statements turns the suite red, which is the shape of level 3 below
without being level 3: that level requires level 1 to fail, and level 1 is satisfied at none of
these sites. For the three that never run, removing a column changes nothing at all — the mock
supplies the value regardless.

**Real database.** None of the six. Every spec stubs the boundary — `createQueryBuilder` as a
chainable mock in the repository spec, `createMock<DataSource>()` in the service spec. A mock cannot
observe which columns were requested, so **level 1, the completeness test, is satisfied nowhere
today**, not even for the three sites whose SQL is asserted. Asserting that a column appears in a
statement is not the same as proving the statement returns every field the response needs.

`executeDebugQuery` is a different case regardless: its field list comes from the request, so an
incomplete result is the caller's doing rather than a defect here. Its 197 specs cover a different
axis — the table and column allowlist, PII masking, parameter binding — and that is the right axis
for it.

So the gap is narrow and specific: **`log.repository.ts:699` is the one site that carries the
projection risk, serves a live endpoint (`PUT /log/financial/validity`), and is not exercised at
all.** What surrounds it is well covered — batching into blocks of 100, the audit trail, rejection
of fabricated audit records, the block on changing validity through the generic update path.

Every other read in the repository either selects only the root alias or nothing at all and
therefore still loads every column; nothing can be missing from those. Each becomes subject to these
tests the moment it is given a field list.

### How they run

Four levels. All of them need a real Postgres instance; a mocked repository returns whatever the
mock defines and cannot see which columns were requested, so it cannot test any of this.

**The repository already has this mechanism — it does not need to be built.** Fourteen migration
specs gate on it:

```typescript
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
```

`.github/workflows/api-pr.yaml` runs a throwaway Postgres 16 as a service and sets that variable,
in **all three test shards** — Jest distributes the suites across shards, so every shard needs its
own instance. Without the variable the blocks are skipped, which is why the suite still passes on a
machine with no database.

The projection tests use that same gate. What they add lives in
`src/shared/utils/projection-test.util.ts`:

- **The schema.** Each spec file creates its own Postgres schema (`const SCHEMA = '…'`) so parallel
  specs cannot collide, and fills it from the entity metadata via `synchronize` rather than from
  replayed migrations — the reference for a projection is the entity definition, not the migration
  history. Measured: 112 entities, 99 tables, 1,736 columns, about half a minute per spec file.
- **The fixtures**, generated from the same metadata. Every scalar column gets a distinct value and
  required relations are created recursively, so an empty field in a response proves the query
  failed to load something. Three kinds of value have to be pinned by hand, and all three are the
  fixture's business rather than the projection's: enum columns stored as text (the metadata reports
  them as `varchar`, so a generated value is not a member of the enum and a mapper looking it up
  answers `undefined`), values a check constraint relates to each other, and relations the schema
  allows to be null but a mapper reads without a guard.

They do **not** run in the main suite, and that is not a preference. The main suite compiles
transpile-only (`tsconfig.json` sets `isolatedModules: true`), which makes TypeScript emit
`design:type` as `Object` for any imported type; building a data source from the entity sources then
fails outright with `Data type "Object" in "Fiat.amlRuleFrom" is not supported`, and no projection
spec could run at all. `jest.projection.config.js` compiles with full type information — the same
reason the Frick and coverage gates have their own configuration — and `npm run test:projection` is
a separate CI job with its own Postgres service.

### What a converted endpoint looks like

The field list is a value, not a chain of calls at the query site: `ReadProjection` in
`src/shared/models/read-projection.ts`. That is what lets level 3 re-run the *production* query with
one field removed. A query rebuilt inside the spec could be wrong in exactly the way the projection
is wrong, and would prove nothing.

A projection separates two kinds of field:

- **Response fields** feed the answer. These are what level 3 drops one at a time.
- **Guards** are loaded but never shown: the primary keys that make the ORM materialise a joined
  row, and values a check reads before the mapper runs — `UserData.status`, which
  `GET /user/profile` refuses merged accounts on. Dropping a guard changes no response field, so
  level 3 would report it as removable although the endpoint breaks without it. Each guard needs an
  assertion of its own instead.

Where a getter branches on a field, the response fields split per branch and each variant asserts
over its own set. `UserData.address` reads the organization's address for a business account and the
account's own for a personal one; a personal-account fixture can say nothing about the organization
fields, and claiming otherwise would be the vacuous kind of green this document is against.

### 1. Completeness

**With a fully populated fixture, no field of the response DTO may be empty.**

If every field of every participating entity carries a distinguishable value, then any `undefined`
in the result proves the query failed to load something.

This is the central test. It needs no reference implementation, is generated per endpoint, and does
not age: when a field is added to a DTO later, it is covered from the first run — which is the more
likely failure over time, since nobody will be thinking about projections by then.

Fixtures are **generated from the metadata**, not hand-written. Every scalar column gets a value
and required relations are created recursively. A hand-written fixture that leaves a field empty
makes the test green and the defect invisible.

### 2. Variants

**One fixture per branch that changes the required field set.**

The getter above needs `firstname` and `surname` for a personal account, but `organizationName`
otherwise. A fixture covering only personal accounts would let a projection missing
`organizationName` pass — and it would then compute wrongly for every corporate customer.

Branches to cover are found where a getter reads a field list conditionally, or where its result
depends on a status field.

### 3. Mutation

**Remove each field of the projection individually; the response must change every time.**

This proves the test looks at anything at all. Where removing a field changes nothing, one of two
things is true: the field is unnecessary and can be dropped permanently, or the fixture never
reaches the branch that reads it — and a real defect would have slipped through there.

**The measure is the response, not emptiness**, and the difference is not academic. The first
version of this level asked whether a field went empty, and it passed a projection missing
`UserData.kycStatus`: `getKycWebhookStatus` answers `NA` when handed nothing, which is a valid value
and a wrong one. Comparing against the response the full projection produced catches it. It is the
same standard as level 4, applied one field at a time.

Without this level you never know whether a green test verified something or is merely green.

**Where a value has a fallback, the candidate may be the chain rather than the column.**
`UserData.completeName` is `organizationName ?? firstname + surname`. Dropping the chain shows the
value depends on it at all; each column on its own is covered by the variant in which it is the one
that gets read — which is also why a fixture has to reach that branch. `kycType` only changes the
answer for a LOCK account: against a DFX one, the value the absent column would produce and the
value it does produce are the same, and no assertion can tell them apart.
`expectEveryFieldRequired` therefore accepts a group of fields as one candidate.

**A missing summand is not a missing field, and level 1 has to say so anyway.** The annual volume on
the support view is `annualBuyVolume + annualSellVolume + annualCryptoVolume`. Leave one of the three
out of the projection and the sum is `NaN` — not absent, so an `undefined` check waves it through,
and the endpoint answers 200 with a number that is not a number. `NaN` therefore counts as empty.

**It needs a baseline, or it is itself merely green.** If the response is already incomplete with
the *full* field list, every reduced run fails too, and "every field is required" comes out true
without a single field having been shown to matter. That happened while the first conversions were
written — a fixture had left an enum at a value the mapper did not know — and the level reported
success. `expectEveryFieldRequired` therefore runs the query unreduced first and refuses to continue
unless that response is complete.

### 4. Consistency against a second source

**Where the same value exists twice, the two must agree.**

For a conversion the second source is always available: **the unprojected load.** Run the endpoint's
mapper over a full `find` of the same fixture, and the two responses must be identical, per variant.
The full load fetches every column, so the *field set* it produces is by construction the one the
endpoint answered from before the conversion — the mapper is the same function in both runs, so a
difference can only come from the columns.

What the level does not verify is the query around them: each spec restates the filter and the
joins, so a spec that restates them wrongly compares two things neither of which is the endpoint.
That part is covered by level 2, which asserts the filter against seeded rows. It is also the only
level that catches a projection loading the *wrong* field rather than too few: level 1 sees a field
that went empty, level 4 sees any field that changed.

It applies separately wherever a value was materialised into its own column while the original
source is still present. In the financial log, `totalBalanceChf` exists both as a column and inside
`message->balancesTotal->totalBalanceChf`; every row must carry the same value in both.

### Deliberately not part of this: a column budget

An upper bound on the number of columns per query was considered and rejected. A projection is
already the protection — with an explicit field list, a new column three subsystems away cannot
inflate the query, which was the original failure. The budget number would be arbitrary, would turn
red on every legitimate new field, and after the third increase would be a ritual rather than a
check.
