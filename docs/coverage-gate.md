# Coverage gates

This repo runs two coverage gates in CI. They answer different questions, and neither replaces
the other.

| Gate             | Config                         | Scope                                      | Question it answers                                      |
| ---------------- | ------------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| Frick gate       | `jest.frick.config.js`         | 10 Frick files, run by 10 Frick specs only | Do _these specs alone_ fully cover _these files_?        |
| Coverage ratchet | `jest.coverage-gate.config.js` | 445 files, whole suite                     | Has coverage regressed anywhere it was already complete? |

## What the ratchet is, and what it is not

The ratchet pins every production file that **already** reaches 100% on all four metrics
(branches, functions, lines, statements). If a change drops any of them below 100 on a pinned
file, CI fails.

It is a **regression gate**, not a statement about test quality:

- It does not claim the repo is well tested. Overall coverage is 59.61% of statements and 42.64%
  of branches; the pinned files are the subset that happens to be complete today.
- It does not verify that a file's _own_ spec covers it. Under a whole-suite run, coverage may
  come from any spec. The Frick gate is the one that makes the stronger per-spec claim, which is
  why it stays separate.
- A newly added production file with no coverage at all passes this gate without complaint. The
  ratchet only protects files already on the list, and that list grows by hand (see "How the list
  grows"). That is the price of the threshold approach.

Of the 445 pinned files, **251 carry real logic** (they have functions and/or branches) and
**194 are purely declarative today** (NestJS modules, constant files with neither). The two groups
are kept visibly separate in the config so the count is not mistaken for test depth.

Pinning the declarative ones is deliberate and not vacuous. Istanbul reports a metric with a total
of 0 as 100%, but adding an unexecuted function or conditional moves that metric from 0/0 to 0/N
and fails the threshold. Statements and lines are pinned as well, so even top-level executable
code that no test reaches turns the gate red.

Test scaffolding is excluded. `shared/utils/test.util.ts` and `shared/utils/test.shared.module.ts`
live outside a `__tests__` directory but are imported only by specs (62 and 29 importers, all
`*.spec.ts`). They are filtered out of `collectCoverageFrom`, so an untested change to a test
helper cannot fail a production gate.

## How the list was measured

Reproduce with:

```bash
npm ci
npm run test:gate:cov
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
No pinned file belongs to the migration suites that `MIGRATION_TEST_PG` enables, and enabling
further suites can only raise coverage, never lower it.

Parallelism does not affect the result: istanbul merges per-worker counters additively, so a
statement executed by a suite counts as executed no matter which worker ran it. Worker scheduling
cannot turn a covered file into an uncovered one, which is why the CI script does not serialise.

The gate runs the whole suite under full compilation, unlike the sharded `test` job that splits
the suite three ways and the Frick gate that runs ten specs. Exact per-file numbers are what
that costs in run time.

## Where the gate runs

On a **self-hosted runner**, unlike every other job in the workflow, and serialised across pull
requests by a `concurrency` group.

Both are conditional. `runs-on` resolves to the self-hosted pool for branches of this repository
and to `ubuntu-latest` for pull requests from forks — a self-hosted runner executes the workflow
and the code of the PR head, and this repository is public. Fork runs get `--maxWorkers=3` to match
a four-vCPU runner, and their own concurrency group, since they share no machine with anything and
have no reason to queue. Deliberately not an `if:` on the job: a skipped check counts as passing,
which would let a fork pull request bypass the gate entirely. Forks run the same gate, slower.

A hosted runner gives a public repository four vCPUs, so Jest defaults to three workers. Measured
there the gate took 13.8 min and single-handedly pushed a PR run from 4.8 to 15.7 min. The team's
ceiling for a full run is 5 min. On the self-hosted runner the same work takes **1.5 min**.

Sharding it across hosted runners was considered and rejected: at 11-12 jobs per push the
repository already reaches the account's 20-concurrent-job limit whenever two runs overlap
(measured: 37-52 s of queueing against 2-3 s otherwise), so more jobs there buy queueing, not
speed. Self-hosted jobs do not count against that limit.

### What was measured, and what it cost to learn

Everything below is measured. Each line replaced an assumption that turned out wrong, so
re-measure before changing any of it.

- **`--maxWorkers=8` — fewer, not more.** At 20 the gate took 8.4 min; at 16 it swung between 1.5
  and 5.4 min across otherwise identical runs; at 8 it took 1.5 min in three consecutive runs with
  no variation. Host CPU never exceeded ~70 % in any of them — not even when two jobs ran side by
  side with twice that many workers and both took 16.6 min. The workers were never short of cores,
  so adding more could not help. Under full compilation
  each holds its own TypeScript program, and how much memory is free on that host varies with what
  else runs there.
- **A `concurrency` group, because two gates at once cripple both.** Two runs started four seconds
  apart each took 16.6 min, against 1.5 min alone. They do not split the machine, they block each
  other. `queue: max` matters: without it a third pull request cancels the already-waiting run, and
  a cancelled check reads as a failure.
- **No `cache: 'npm'` on that job**, unlike the hosted ones. A persistent runner keeps `~/.npm`
  between jobs, so restoring gains nothing while saving uploads a cache nobody reads. It cost
  5.3 min per run — more than moving off hosted runners saved in the first place.
- **A cold runner reports roughly double.** The first run on a freshly registered slot took 6.8 min
  for work that later took 1.5. Each slot warms separately. A first measurement is not a result.

### The gate is no longer the bottleneck — but the margin is not the gate's

At 1.5 min the gate is well clear of the sharded `test` job at ~4.2 min, which now decides how long
a run takes. Full runs measured at **4.9-5.0 min**: the ceiling is met, but by seconds, and
tightening the gate further buys nothing.

Two caveats worth knowing before reading a slow run as a regression:

- **Serialisation is not free.** A run that waits for another pull request's gate carries that wait
  in its total. Three runs queued back to back measured 5.0, 4.9 and 7.6 min — all with a 1.5 min
  gate. Waiting is still much cheaper than colliding (7.6 against 16.6 min), but it can breach the
  ceiling when several pull requests land together.
- **The remaining margin belongs to the `test` shards.** If runs need to get reliably faster, that
  is where to look, not here.

## What happens when a pinned file changes

Both failure modes are loud, verified against jest 29.7 rather than assumed:

| Situation                              | Result                                      | Exit |
| -------------------------------------- | ------------------------------------------- | ---- |
| Pinned file drops below 100%           | `coverage threshold for ... not met: <pct>` | 1    |
| Pinned file deleted, renamed, excluded | `Coverage data for ... was not found`       | 1    |

The second row is the important one: the gate cannot silently stop protecting a file. Threshold
keys are resolved with `path.resolve` against the working directory, and both `npm run
test:gate:cov` and the workflow run from the repo root, so the `src/...` keys match the coverage
map.

The run also writes an `lcov` report under `coverage-gate/`. On failure the CI job uploads that
directory as the `coverage-gate` artifact (7-day retention, via `actions/upload-artifact@v7`,
step "Upload coverage report" on the "Coverage ratchet" job). That shows which lines are missing
without re-running the whole gate locally — which on a developer machine, without the CI runner's
warm caches, is a good deal slower than the 1.5 min it takes in CI.

## Current state

Measured on develop @ 77a106207 with this PR's change applied.

The collection glob matches 1,657 files under `src/`. 1,606 of them contain instrumentable code
and appear in the report. The remaining 51 compile to no executable statements and therefore
cannot be measured or pinned: 49 are type-only (interfaces, type aliases, response shapes), one
consists entirely of commented-out code (`integration/exchange/services/p2b.service.ts`) and one
is empty (`subdomains/supporting/payin/enums/index.ts`, 0 bytes). Those two are pre-existing and untouched here;
deleting them would be a separate cleanup.

| Class    | Files | Meaning                                         |
| -------- | ----- | ----------------------------------------------- |
| Complete | 445   | Pinned by the ratchet at that commit            |
| Partial  | 1,034 | Some coverage, below 100 on at least one metric |
| None     | 127   | No coverage at all                              |

Totals: statements 59.61%, branches 42.64%, functions 34.21%, lines 59.97%.

Coverage is very unevenly distributed. `subdomains/supporting/payout` has 69 of 102 files
complete; `subdomains/supporting/dex` has 6 of 170, `subdomains/supporting/payin` 6 of 102, and
`subdomains/core/liquidity-management` 9 of 64. Nine files under `subdomains/supporting/mros` and
six under `subdomains/generic/admin` have no coverage at all.

## How the list grows

Any PR may add files to `coverageThreshold` once they reach 100%.
`jest.coverage-gate.config.js` holds the 445 paths in two arrays, `PINNED_LOGIC` (logic-carrying
files) and `PINNED_DECLARATIVE` (purely declarative files), from which `coverageThreshold` is
generated. Adding a file means appending its path to the matching array, not writing out a
`coverageThreshold` object entry by hand.

After each gate run the job reports which files already reach 100% on all four metrics but are
not pinned yet. `scripts/coverage-unpinned-complete.js` reads that run's own `json-summary`
report and prints the candidates. The step is deliberately non-blocking: a pull request can
complete a file it never touched, and failing CI for that would train the team to ignore a red
gate. Anyone extending the list can take the candidates from the job output instead of
reconciling the report by hand.

The intended next step is the set already within reach: **25 files sit at ≥90% on all four
metrics**, several of them one or two uncovered branches away. Examples:

| File                                                                         | branches | functions | lines | statements |
| ---------------------------------------------------------------------------- | -------- | --------- | ----- | ---------- |
| `src/subdomains/core/accounting/services/ledger-cutover.service.ts`          | 98.55    | 100       | 99.33 | 99.1       |
| `src/subdomains/core/accounting/services/consumers/exchange-tx.consumer.ts`  | 96.29    | 100       | 100   | 99.54      |
| `src/subdomains/core/accounting/services/ledger-reconciliation.service.ts`   | 95.52    | 100       | 99.41 | 99.48      |
| `src/subdomains/core/accounting/services/consumers/payout-order.consumer.ts` | 93.47    | 100       | 100   | 99.44      |

Not every remaining branch is reachable by a test. Some of the open branches are defensive
fallbacks that cannot fire at runtime — for example `name.split('/').pop() ?? name` (split
always returns at least one element) and `+(raw.legCount ?? 0)` over a SQL `COUNT(*)`, which is
never null. Covering such a branch would require inventing a mock the data source cannot
actually produce, which proves nothing. The correct fix is to remove the unreachable fallback,
which is also what the project's rule against silent fallbacks calls for.
Both examples above were closed that way: the fallback was deleted, not covered.

To regenerate the full picture, run the gate and read `coverage-gate/coverage-summary.json`.

**Removing a file from the list is not a normal fix.** If a change makes a pinned file drop
below 100, the expected response is to extend the tests. Unpinning is an explicit decision that
belongs in the PR description, not a silent edit.

That rule stays hard for the 251 logic-carrying files. A foreseeable friction case is different:
when one of the 194 purely declarative files (a NestJS module, a constants file) first gains
executable logic — for example a `useFactory` on a module — the function metric jumps from 0/0 to
0/N and the gate turns red. Tests remain the preferred fix, but unpinning that one file is an
allowed outcome if the PR description names and justifies it (not as a silent edit). For
logic-carrying files the rule is unchanged: extend the tests.
