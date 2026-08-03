# Read-path projections

What the load-site inventory shows, what we intend to do about it, and how the result is to be
tested.

## The goal

**Every read path in this service selects the fields it returns, and nothing more.** That is the
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
  render a PDF containing a handful of values. That query sat exactly on Postgres' limit of 1,664
  columns per statement, so a single column added elsewhere (`settlementEventId` on
  `transaction_request`) was enough to push it over.
- Of the 534 endpoints, **432 reach at least one load site that fetches whole rows**; 98 read
  nothing at all, and **2 read only the fields they return**. The widest query a fetching endpoint
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

**No read model.** Of the 1,105 load sites in this repository, **six** name the columns they need:
one query builder and the five raw statements. The other 1,099 request whole rows — 971 through the
`find` family, and of the 129 query builders, 105 pass the root alias to `.select(...)`, which reads
like a projection but is not, while 23 pass no select at all. The same entities serve persistence,
business logic and pure output paths such as invoices, receipts, history and exports — which need
fields, not objects.

## Vocabulary

| Term | Meaning here |
| ---- | ------------ |
| **Overfetching** | Loading or transferring more data than the result needs. The umbrella term for this whole topic. |
| **Eager loading** | Automatically loading related entities, recursively. The opposite is lazy loading. |
| **Projection** | Selecting only the columns the result needs. The countermeasure. |
| **Read path** | An endpoint that only reads and renders data, and writes nothing back. |
| **Write path** | An endpoint that persists a loaded entity — it needs the complete object. |
| **Read model** | A separate model optimised for reading. Introducing projections for read paths is a small step towards one. |

Note that eager relations apply to the `find*` family, **not** to `createQueryBuilder` and not to
raw SQL. [load-sites.md](load-sites.md) records that mechanism for each of the 1,105 load sites,
together with the measured column count.

[endpoints.md](endpoints.md) summarises this per endpoint, as the union over every load site the
endpoint can reach. That column answers one question only — *does this endpoint load more than it
needs* — and any single offending site is enough to answer yes. It deliberately says nothing about
where the bulk of the work happens: an endpoint whose own query is raw SQL is still marked when a
permission check on the way loads a full row. For that question the load site is the level at
which the statement is unambiguous, which is why both documents exist.

## What we intend to change

Read paths select the fields they return, via a query builder with an explicit field list. Write
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
   columns named in the call — so it does not disqualify a read path, **unless a value it writes is
   derived from what was read**. That case is real and stays excluded.
2. **The entity is not handed to code whose use of it is unknown** — an event handler, a generic
   service, a queue.
3. **All result-relevant fields are statically determinable.** Ruled out by dynamic field access
   (`this[variable]`) unless the field list resolves to a constant. Two such getters exist, both in
   `user-data.entity.ts`.
4. **The endpoint returns a DTO**, not an entity and not a binary stream. When an entity is
   returned, the required field set is not defined by a contract and cannot be narrowed safely.
5. **The tests below pass.**

The first four are pre-filters; the fifth decides.

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
money, a silent wrong value is worse than a crash: a 500 is found within hours — the outage
described above proves it — a wrong value can run for weeks.

## Test definition

All four levels must pass for an endpoint to count as converted. `endpoints.md` records the state
per endpoint as `0/4` through `4/4`; only `4/4` is done.

### Which endpoints these apply to

To any load site that carries an explicit field list — that is where a forgotten field silently
yields an empty value.

Today that is **six sites**, and this is what the suite covers of them:

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
that `message` never appears in the statement at all. Drop a column from those statements and the suite turns red.
That is level 3 of the definition below, reached for three sites. For the three that never run,
removing a column changes nothing: the mock supplies the value regardless.

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

The projection tests should use the same mechanism rather than introduce a second one.

Two things are missing, and only two:

- **The schema.** The migration specs each create their own Postgres schema (`const SCHEMA = '…'`)
  so that parallel specs cannot collide. The projection tests need the same isolation, but their
  schema comes from the entity metadata via `synchronize` rather than from replayed migrations —
  the reference for a projection is the entity definition, not the migration history.
- **The fixtures**, generated from the same metadata.

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

**Remove each field of the projection individually; level 1 must fail every time.**

This proves the test looks at anything at all. Where removing a field changes nothing, one of two
things is true: the field is unnecessary and can be dropped permanently, or the fixture has a gap
at exactly that point — and a real defect would have slipped through there.

Without this level you never know whether a green test verified something or is merely green.

### 4. Consistency against a second source

**Where the same value exists twice, the two must agree.**

Applies wherever a value was materialised into its own column while the original source is still
present. In the financial log, `totalBalanceChf` exists both as a column and inside
`message->balancesTotal->totalBalanceChf`; every row must carry the same value in both. Where such
an invariant exists it is the strongest available test, because it needs no second implementation
that could itself be written wrong.

### Deliberately not part of this: a column budget

An upper bound on the number of columns per query was considered and rejected. A projection is
already the protection — with an explicit field list, a new column three subsystems away cannot
inflate the query, which was the original failure. The budget number would be arbitrary, would turn
red on every legitimate new field, and after the third increase would be a ritual rather than a
check.
