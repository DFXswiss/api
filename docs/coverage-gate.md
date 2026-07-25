# Coverage gates

This repo runs two coverage gates in CI. They answer different questions, and neither replaces
the other.

| Gate             | Config                         | Scope                                    | Question it answers                                      |
| ---------------- | ------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| Frick gate       | `jest.frick.config.js`         | 7 Frick files, run by 7 Frick specs only | Do _these specs alone_ fully cover _these files_?        |
| Coverage ratchet | `jest.coverage-gate.config.js` | 401 files, whole suite                   | Has coverage regressed anywhere it was already complete? |

## What the ratchet is, and what it is not

The ratchet pins every production file that **already** reaches 100% on all four metrics
(branches, functions, lines, statements). If a change drops any of them below 100 on a pinned
file, CI fails.

It is a **regression gate**, not a statement about test quality:

- It does not claim the repo is well tested. Overall coverage is 57.7% of statements and 39.5%
  of branches; the pinned files are the subset that happens to be complete today.
- It does not verify that a file's _own_ spec covers it. Under a whole-suite run, coverage may
  come from any spec. The Frick gate is the one that makes the stronger per-spec claim, which is
  why it stays separate.

Of the 401 pinned files, **218 carry real logic** (they have functions and/or branches) and
**183 are purely declarative today** (NestJS modules, constant and type-only files with neither).
The two groups are kept visibly separate in the config. Pinning the declarative ones is
deliberate: the moment logic is added to one, it must arrive with tests or the gate turns red.

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

## Current state

Measured over 1,593 production files under `src/`:

| Class    | Files | Meaning                                         |
| -------- | ----- | ----------------------------------------------- |
| Complete | 401   | Pinned by the ratchet                           |
| Partial  | 1,062 | Some coverage, below 100 on at least one metric |
| None     | 130   | No coverage at all                              |

Totals: statements 57.67%, branches 39.47%, functions 31.85%, lines 57.98%.

Coverage is very unevenly distributed. `subdomains/supporting/payout` has 69 of 102 files
complete; `subdomains/supporting/dex` has 6 of 170, `subdomains/supporting/payin` 6 of 102, and
`subdomains/core/liquidity-management` 7 of 62. Nine files under `subdomains/supporting/mros` and
six under `subdomains/generic/admin` have no coverage at all.

## How the list grows

Any PR may add files to `coverageThreshold` once they reach 100%. The intended next step is the
set that is already within reach: **29 files sit at ≥90% on all four metrics**, several of them
one or two uncovered branches away. Examples:

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
