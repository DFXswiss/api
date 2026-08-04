# Bank-processing monitoring

The `BankProcessingObserver` watches **open bank-processing transactions** as 45 declarative
rules and publishes the result every 5 minutes — into the monitoring `SystemState` and as
structured log lines that downstream dashboards parse. It replaces a legacy spreadsheet-based
ops monitor whose alert path had silently died.

Source of truth: `src/subdomains/core/monitoring/observers/bank-processing/` —
`bank-processing.rules.ts` (rule catalog and tolerance model), `bank-processing.query.ts`
(query assembly and result mapping), `bank-processing.observer.ts` (cron job and emission).
The job itself is listed in [docs/cron-jobs.md](cron-jobs.md).

## Rule model

Rules are grouped into six blocks, each with a base filter and one bundled aggregation query
(CASE sums — one statement per base table, not one per rule):

| Block | Table | Base filter |
| ----- | ----- | ----------- |
| `bankTx` | `bank_tx` | type unassigned, `Pending` or `GSheet` |
| `buyCryptoFiat` | `buy_crypto` | fiat-funded (`bankTxId` set), incomplete |
| `buyCryptoCrypto` | `buy_crypto` | crypto-funded (`cryptoInputId` set), incomplete |
| `buyFiat` | `buy_fiat` | incomplete |
| `fiatOutput` | `fiat_output` | incomplete |
| `bankTxReturn` | `bank_tx_return` | chargeback not booked yet |

Per rule the observer reports `count` and `chfSum` (current backlog) plus `overdueCount` and
`overdueChf` (entries older than the rule's tolerance). Two kinds of rules exist, enforced at
the type level:

- **Tracked** rules carry a tolerance and a tolerance field (`created` or `updated`); all
  overdue fields are numbers.
- **Display-only** rules have no tolerance; `overdueCount`, `overdueChf` and
  `toleranceMinutes` are all `null`. `null` is exclusively this marker — consumers must never
  interpret it as "zero overdue".

Tolerances are either fixed minutes or **dynamic**: an hour-of-day table in Europe/Zurich
(2 h during business hours, up to 18 h at night) plus a weekend surcharge (Sat +1.5 d,
Sun +2.5 d, Mon before 07:12 +3.5 d).

## Log interface

The log lines are a monitoring contract; field names and prefixes must stay stable:

```
BankProcessing state snapshot: 45 rule(s), 2 overdue
BankProcessing rule snapshot: {"key":"bc-aml-manual-check","block":"buyCryptoFiat","label":"BuyCrypto AML Pending ManualCheck","count":1,"chfSum":932.8,"overdueCount":1,"overdueChf":932.8,"toleranceMinutes":7200}
```

The summary line is a heartbeat and is written even when everything is healthy. A missing
heartbeat means "monitoring is down" — consumers must render that as unknown, never as
"all clear". A failing block aborts the whole run before anything is emitted, so a heartbeat
never covers partial data; non-finite aggregation values abort the run as well.

## Execution

`@DfxCron(EVERY_5_MINUTES)` with scope `worker`, its own process gate
(`BankProcessingMonitoring`) and an explicit finite lock timeout (1800 s, sibling parity).
The emitted state reaches the API process through the persisted monitoring snapshot.

## Accepted limitations

- The six block queries are separate statements: a row moving between tables mid-run can
  appear in two rules for one 5-minute cycle. Tolerances are minutes to days, so a single
  cycle of skew cannot create a lasting false overdue state.
- CHF sums for `bank_tx` and `fiat_output` are approximations via `fiat.approxPriceChf`;
  rows with non-convertible currencies drop out of the sum while the count stays complete.
  Rounding follows the repo-wide `Util.round` semantics.
- Observe-only phase: no alerting and no health-check gate are attached yet; the legacy
  backlog surfaced by the un-ported per-ID exceptions is triaged first.
