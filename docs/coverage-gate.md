# Coverage gates

This repo runs two coverage gates in CI. They answer different questions, and neither replaces
the other.

| Gate             | Config                         | Scope                                    | Question it answers                                      |
| ---------------- | ------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| Frick gate       | `jest.frick.config.js`         | 7 Frick files, run by 7 Frick specs only | Do _these specs alone_ fully cover _these files_?        |
| Coverage ratchet | `jest.coverage-gate.config.js` | 399 files, whole suite                   | Has coverage regressed anywhere it was already complete? |

## What the ratchet is, and what it is not

The ratchet pins every production file that **already** reaches 100% on all four metrics
(branches, functions, lines, statements). If a change drops any of them below 100 on a pinned
file, CI fails.

It is a **regression gate**, not a statement about test quality:

- It does not claim the repo is well tested. Overall coverage is 57.66% of statements and 39.46%
  of branches; the pinned files are the subset that happens to be complete today.
- It does not verify that a file's _own_ spec covers it. Under a whole-suite run, coverage may
  come from any spec. The Frick gate is the one that makes the stronger per-spec claim, which is
  why it stays separate.

Of the 399 pinned files, **217 carry real logic** (they have functions and/or branches) and
**182 are purely declarative today** (NestJS modules, constant files with neither). The two groups
are kept visibly separate in the config so the count is not mistaken for test depth.

Pinning the declarative ones is deliberate and not vacuous. Istanbul reports a metric with a total
of 0 as 100%, but adding an unexecuted function or conditional moves that metric from 0/0 to 0/N
and fails the threshold. Statements and lines are pinned as well, so even top-level executable
code that no test reaches turns the gate red.

Test scaffolding is excluded. `shared/utils/test.util.ts` and `shared/utils/test.shared.module.ts`
live outside a `__tests__` directory but are imported only by specs (60 and 28 importers, all
`*.spec.ts`). They are filtered out of `collectCoverageFrom`, so an untested change to a test
helper cannot fail a production gate.

## How the list was measured

Reproduce with:

```bash
npm ci
npm run test:cov:gate
```

Two properties of that run matter, and changing either invalidates the numbers:

1. **Full compilation.** The transform uses `tsconfig.coverage.json` (`isolatedModules: false`),
   the same as the Frick gate. The main suite runs ts-jest in transpile-only mode, which emits
   the `emitDecoratorMetadata` helpers differently and reports phantom uncovered branches on
   dependency-injected constructors. Measured transpile-only, dozens of files would look
   incomplete when they are not.
2. **Whole suite.** Files are frequently covered by specs other than their own, so a narrower
   run would understate coverage and shrink the list for no reason.

The gate job deliberately runs **without** the Postgres service that the sharded `test` job uses.
The pinned list was derived from a run without it, and the migration suites it enables are not
part of that list — running them can only raise coverage, never lower it.

Parallelism does not affect the result: istanbul merges per-worker counters additively, so a
statement executed by a suite counts as executed no matter which worker ran it. Worker scheduling
cannot turn a covered file into an uncovered one, which is why the CI script does not serialise.

The gate runs the whole suite under full compilation, unlike the sharded `test` job that splits
the suite three ways and the Frick gate that runs seven specs. Exact per-file numbers are what
that costs in run time.

## What happens when a pinned file changes

Both failure modes are loud, verified against jest 29.7 rather than assumed:

| Situation                              | Result                                      | Exit |
| -------------------------------------- | ------------------------------------------- | ---- |
| Pinned file drops below 100%           | `coverage threshold for ... not met: <pct>` | 1    |
| Pinned file deleted, renamed, excluded | `Coverage data for ... was not found`       | 1    |

The second row is the important one: the gate cannot silently stop protecting a file. Threshold
keys are resolved with `path.resolve` against the working directory, and both `npm run
test:cov:gate` and the workflow run from the repo root, so the `src/...` keys match the coverage
map.

## Current state

The collection glob matches 1,643 files under `src/`. 1,591 of them contain instrumentable code
and appear in the report. The remaining 52 compile to no executable statements and therefore
cannot be measured or pinned: 50 are type-only (interfaces, type aliases, response shapes) and 2
consist entirely of commented-out code (`integration/exchange/services/p2b.service.ts`,
`subdomains/supporting/payin/enums/index.ts`). Those two are pre-existing and untouched here;
deleting them would be a separate cleanup.

| Class    | Files | Meaning                                         |
| -------- | ----- | ----------------------------------------------- |
| Complete | 399   | Pinned by the ratchet                           |
| Partial  | 1,062 | Some coverage, below 100 on at least one metric |
| None     | 130   | No coverage at all                              |

Totals: statements 57.66%, branches 39.46%, functions 31.84%, lines 57.98%.

Coverage is very unevenly distributed. `subdomains/supporting/payout` has 69 of 102 files
complete; `subdomains/supporting/dex` has 6 of 170, `subdomains/supporting/payin` 6 of 102, and
`subdomains/core/liquidity-management` 7 of 62. Nine files under `subdomains/supporting/mros` and
six under `subdomains/generic/admin` have no coverage at all.

## How the list grows

Any PR may add files to `coverageThreshold` once they reach 100%. The intended next step is the
set already within reach: **29 files sit at ≥90% on all four metrics**, several of them one or two
uncovered branches away. Examples:

| File                                                                        | branches | functions | lines | statements |
| --------------------------------------------------------------------------- | -------- | --------- | ----- | ---------- |
| `src/subdomains/core/accounting/services/consumers/exchange-tx.consumer.ts` | 97.03    | 100       | 100   | 99.54      |
| `src/subdomains/core/accounting/services/ledger-reconciliation.service.ts`  | 95.52    | 100       | 99.41 | 99.48      |
| `src/subdomains/core/accounting/services/ledger-mark.service.ts`            | 95.23    | 100       | 100   | 98.95      |
| `src/integration/infrastructure/storage/s3-storage.service.ts`              | 95       | 100       | 100   | 100        |

To regenerate the full picture, run the gate and read `coverage-gate/coverage-summary.json`.

**Removing a file from the list is not a normal fix.** If a change makes a pinned file drop
below 100, the expected response is to extend the tests. Unpinning is an explicit decision that
belongs in the PR description, not a silent edit.
