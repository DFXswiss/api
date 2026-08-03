> [!IMPORTANT]
> **`CRON_ROLE` must be set in every environment before this is deployed.** The boot aborts
> without it — deliberately, see below — so an environment missing the variable fails on the next
> deploy, whatever that deploy was for. The two repositories have separate pipelines with no
> dependency between them: merging here triggers a deploy without checking whether the variable is
> already in place. The configuration change is a separate, already open PR in the infrastructure
> repository; it is inert for the currently running image.

> [!WARNING]
> **This PR bundles four subsystems, and a revert is all-or-nothing across all four.** That is a
> deliberate decision, recorded here so it does not surprise anyone at merge time. See
> [What this PR bundles](#what-this-pr-bundles) directly below before approving.

## What this PR bundles

The title says process separation, and that is the reason the branch exists. It is not all the
branch contains. Four independently revertable subsystems ended up on one branch, and because they
are one branch they are also one revert: pulling any of them out after the fact pulls out the other
three.

| Area | What is in here | Why it is entangled |
|---|---|---|
| **Process split** | `CRON_ROLE`, `CronScope`, mandatory `scope` on 140 `@DfxCron` declarations, boot log, role heartbeat | The subject of the PR |
| **Cross-process lease** | `cron_lease` table, migration, entity, `CronLeaseService`, shutdown handler in `main.ts` | Only meaningful once two processes exist, and the split is what makes the in-process lock insufficient |
| **OpenTelemetry metrics pipeline** | `src/runtime-metrics.ts`, new dependencies, new `OTEL_METRIC_EXPORT_INTERVAL` | Written to measure the event loop saturation that motivated the split; independent of it at runtime |
| **`MonitoringService` rework** | DB-backed read path, 30 s process cache, `pessimistic_write` merge on write | Forced by the split: with the observers on the worker, the API process has no state of its own to serve |
| **`DashboardFinancialService` rework** | Aggregation stays in the worker, response building becomes its own `api` job, `LatestBalanceStore` | Forced by the split, for the same reason |

Two of the five (metrics pipeline, and the lease insofar as it changes the schema) would stand on
their own. They are not being split out: the operator has decided against a follow-up PR, so the
bundling is stated instead of removed. What that means concretely:

- **A revert of this PR removes the OTLP event-loop metrics** and any dashboard or alert built on
  them, whether or not the reason for reverting had anything to do with them.
- **A revert re-introduces the monitoring read path that answers from process memory**, which is
  wrong in a two-process deployment — so a revert here has to be accompanied by a rollback of the
  role configuration, not just of this code.
- **A revert does not drop the `cron_lease` table.** The migration is not reverted by reverting the
  code; the table is simply left unused.

The safe rollback is not a revert of this PR but `CRON_ROLE=all`, under which every process
registers every job. That is the mode this branch is designed to be merged in.

## Why

Background jobs and HTTP requests share a single Node event loop, and Node runs JavaScript on one
thread. A CPU-heavy job therefore delays every request in the same process.

Measured in production while investigating slow API responses:

| Signal | Value |
|---|---|
| Event loop utilization | 84% mean, p90 100% |
| Event loop delay | mean 339 ms, p95 up to 5.3 s |
| `/version` (no DB access, 1 ms handler), measured locally against the container | p50 7 ms, **p95 5.5 s**, max 16 s |
| Actual HTTP load | 1.9 req/s |

A p50 of a few milliseconds next to a p99 in the seconds is the signature of a blocked loop, not of
slow work: the same distribution reproduces on a route touching neither the database nor any
external service, and it persists when the network path is bypassed entirely. Database, host and
network were each ruled out separately — during one 6.1 s freeze the database had zero active
queries, and the connection pool never had a single waiting request.

The cause is the scheduler, not traffic. Grouping the delay measurements by second-within-minute
over six hours (2,154 windows) gives stall rates of 5.8 / 52.8 / 73.3 / 81.8 / 50.0 / 21.2 % — a
factor of 14, following the scatter curve of the job start delay exactly. Request traffic in the
same grid varies by a factor of 2 and peaks elsewhere.

## What changes

This PR is the application half of running the same image twice: one process serving HTTP, one
running the background work. Under `CRON_ROLE=all` no existing `@DfxCron` is left out on account of
its scope — new are the role heartbeat, the Spark wallet maintenance job, `refreshLatestBalance`,
the payment delivery job, the WebSocket liveness sweep and the registration logs.

**1. `CRON_ROLE` decides which jobs a process registers**, and `CronScope` says which process a job
belongs to. Three values each, because two would not be enough in either direction:

- A role `all` is needed because otherwise no value covers every job — local development, the test
  suite and any deployment without a separate worker would each lose something.
- A scope `api` is needed because some work is bound to the process holding the open connections —
  state a request path reads in *this* process, which a job running elsewhere cannot maintain.
  Delivering to those connections is a different matter and is no longer done from an `api`-scoped
  job; see [The api scope and the lease](#the-api-scope-and-the-lease-pull-against-each-other) for
  why that separation had to be made.

The variable has no default and an unknown or empty value aborts the boot. Every possible default
is silent in one direction: `worker` would make a misconfigured API process run all background work
twice, `api` would make a misconfigured worker do nothing at all.

**2. `scope` is mandatory on every `@DfxCron`.** A wrong classification fails silently — a job
wrongly scoped `worker` leaves the cache it maintains empty in the process that reads it, with no
error anywhere. A default plus an exception list moves that decision into a hand-maintained list
the compiler never sees; such a list grows and goes stale, and pinning it in a test proves the
state of the list rather than the property it stands for.

Counted from the source tree rather than carried forward: **140 `@DfxCron` declarations — 119
`worker`, 5 `api`, 16 `both`**, across 98 files and 34 areas; 118 carry a `process` flag, 22 do
not, five of those deliberately. 139 of the 140 have a registration path. `docs/cron-jobs.md`
carries the assignment per job, generated from the decorators, and both of its distribution tables
sum to 140.

**3. Cases where a scope alone would not have been enough:**

- **Monitoring state** (11 observers behind `GET /health*` and `/monitoring/data`). Scoping the
  observers to the worker would freeze eleven endpoints at the boot snapshot in the API process,
  the health report included; scoping them to the API process would move AML, node and bank queries
  back into the request path. The state is already persisted in full, so the read path takes it from
  there with a 30-second process cache. The write path needed its own answer: every process writes
  the whole state as a single row, so only the metrics changed in this process are merged into the
  stored row — otherwise whichever writes last drops the other's work.
- **The dashboard balance store**, written by the financial aggregation and read without touching
  the database. That property was measured (23 ms median, 1,989 ms p95 before it existed) and is
  kept: building the response becomes its own minute job scoped `api`, and the aggregation stays in
  the worker.
- **Periodic work registered outside the scheduler** — two native `@Cron` decorators and a bare
  `setInterval` driving on-chain wallet maintenance. All three would have run in both processes.
  A test forbids the patterns, and carries no exceptions.

**4. Four jobs gain a `process` flag** so a single misbehaving job can be stopped at runtime
instead of by deploy, and the worker reports itself under its own service name so its outgoing
calls do not read as API traffic.

## Cross-process lease

An architecture review named the load-bearing assumption of the original design: *"there is exactly
one worker, and the configuration is right"*. It was held up by convention, a runbook sentence and
an alert that **reports** a double run 15–25 minutes later. For a path that moves money, detection
is the second-best answer — and `LockClass` keeps its state in a field in process memory, so it
cannot see a second process at all.

**Jobs scoped `worker` or `api` hold a lease in the `cron_lease` table for the duration of their
run.** A single statement decides it: the upsert takes the row over only if it has expired. Two
processes racing are serialised by the primary key and one of them gets a row back.

**What that is worth, stated precisely.** The lease does not exclude a double run, and it does
not bound how long one lasts. A job runs once because the deployment runs one worker and because
the job tolerates being run again. What the lease adds underneath those two properties is that a
second process has to take the claim before it may **start** the job: while the holder keeps
renewing, a wrongly configured second process — a missed recreate, a second worker from `--scale`,
two processes left on `all` after a rollback — does not start it at all. If the holder stops
renewing while it is still working, the claim lapses, the second process starts, and the first runs
on to its own end; nothing here shortens that, because a running function cannot be aborted from
the outside in JavaScript and a cooperative check at every write is the same work as the fencing
token this does not carry. `CronLeaseService` says so in its own "What it does not do".

What the lease **does** bound is the waiting: a claim left behind by a process that was killed
blocks the job for the lease TTL rather than until somebody reads an alert, and that same span is
the longest a second process waits before it may take the job over.

**Scope `both` is deliberately exempt.** Those jobs maintain state a request path reads in *their
own* process; a lease over them would starve whichever lost the race and freeze that state. Their
safety comes from a different property: running twice has to be harmless by construction, which is
what CONTRIBUTING requires of them.

**Why a lease and not an advisory lock.** `pg_advisory_lock` is bound to the connection and would
hold a pooled connection for the whole runtime of the job. 67 jobs declare a timeout measured in
minutes; that is a real risk to a connection pool sized by `SQL_POOL_MAX`. An expiring row
costs one short query each to take, extend and release.

**The lease is 60 seconds, renewed every 20, and unrelated to the job's timeout.** The expiry bounds
how long a claim outlives an owner that can no longer speak for itself — SIGKILL, an OOM kill, a
lost machine. That is a property of the failure mode, not of the work, and deriving it from the
job's own timeout got it backwards: `timeout` is measured in seconds and nineteen `@DfxCron`
declarations carry 7200, so a process killed mid-run used to block its own successor from that job
for up to two hours, silently.

**Shutdown is the other half.** Nothing in this repository ever asked for a shutdown hook, so
SIGTERM ended the process instantly and the release in the `finally` never ran.
`CronLeaseService.shutdown` now waits up to ten seconds for the runs this process holds, so their
normal release hands the job to the successor. A run still going after that **keeps** its lease:
taking it away would let the successor start the same job while this process works on it for the
rest of the grace, which is the outcome the lease exists to make rare.

It hangs off a SIGTERM/SIGINT handler rather than `app.enableShutdownHooks()`, and that is
deliberate. The idiomatic call is global: it would also start running the nine `onModuleDestroy`
implementations this application carries but has never executed, and Nest runs those *before* the
lease hook — they empty the strategy registries that PayIn, PayOut and DEX jobs resolve from. On
its own that is harmless, since the process was about to die. Next to this change it is not: the
wait deliberately keeps in-flight jobs alive longer, so a running payout would gain time to fail on
an emptied registry rather than simply be cut off. A test pins that the idiomatic call stays out.

**An unusable lease table is reported rather than silent.** Without it every worker- and api-scoped
job is skipped on every tick — the right behaviour, and what CONTRIBUTING asks for, but the skip
used to look exactly like a job with nothing to do. The role heartbeat is scope `both` and
therefore exempt from the lease, so it kept reporting a healthy process while everything it counts
sat out; and it counts *registered* jobs, which cannot see this at all. The lease layer now reads
the table at start-up and carries a health flag that stays false until an operation gets through;
the heartbeat writes the same line at error level with the reason appended when it is bad. The same
line, because the role alert matches on its shape.

**What it still cannot do — and the code says so.** If the holder stops renewing while a job runs,
the claim expires and a second process can start the job while the first is still working, for as
long as that first run takes. Full fencing would need a token on every single write. What the lease
shortens is the wait, not the overlap.

**With the database unreachable the job does not run.** A job that moves money must not proceed on
the assumption that it is probably alone — and that is exactly when the assumption is least safe.

### The api scope and the lease pull against each other

`PaymentCronService` writes to the database and triggers merchant webhooks, which argues for one
process, and it used to be the only thing releasing the callers waiting on the process that ran it,
which argues for every process. A single scope cannot satisfy both, and the lease made that
visible: whichever process lost the claim left its callers waiting for nothing.

The resolution taken is to split the job rather than the scope. The writing runs under the lease
(`Worker`), and `deliverPaymentUpdates` delivers from the state those writes leave behind, scoped
`Both`, in every process, without a lease — it writes nothing and calls nothing outside its own
process, which is what allows it to run everywhere. An `api`-scoped job losing the race is still
logged at error level, unlike a worker job, which loses it every cycle by design.

Leaving `Pending` is decided by the update statement rather than by a status read, because the
expiry timers stay in the process that served the request while the expiry job runs in the worker,
and cancelling and completing arrive from request paths as well. Only the caller the database lets
past `Pending` sends the merchant its webhook.

## Schema

`migration/1785600000000-AddCronLease.js` creates `cron_lease`. Two things worth stating:

- The primary key is `PK_a12c181c2b26f33be13d55a15af` — `PK_` plus the first 27 characters of
  `sha1('cron_lease_name')`, which is what TypeORM's own naming strategy produces. A hand-picked
  name would not be recognised by a schema comparison, which would then offer to create the
  constraint. A new test recomputes every primary key declared in a `CREATE TABLE` across all
  migrations (102 of them, all matching) and rejects any spelled-out constraint name.
- `acquired` and `expires` are `timestamptz`. They are compared against `now()` in raw SQL, and a
  value without a zone on one side of that comparison resolves through whatever time zone the
  session carries: the same row expires an hour late or an hour early across a daylight saving
  change. An hour late is a job that runs nowhere, an hour early is two processes running it.

`src/shared/models/cron-lease/cron-lease.entity.ts` mirrors the table. The service never reads
through a repository — the claim is a single `INSERT .. ON CONFLICT .. WHERE` the query builder
cannot express — but a table that exists only as DDL is invisible to the entity model, and the next
generated migration would read that absence as an instruction to `DROP TABLE "cron_lease"`. A test
builds the entity metadata without a connection and checks it against the migration file.

## Deployment

The order matters and is not optional:

1. **`CRON_ROLE=all` must be set in every environment before this PR is deployed.** The boot aborts
   without it, so an environment missing the variable fails on the next routine deploy — for the
   currently running image the variable is unknown and therefore inert.
2. Merge and deploy this PR. The migration creating `cron_lease` runs with it.
3. Observe: the boot log states the split — `CronRole all: registered 139 of 139 jobs (worker: 119,
   api: 4, both: 16)` — and health and dashboard endpoints answer unchanged.
4. Alerting, log-level normalisation, runbooks and dashboards — before, not after the next step.
5. Create the second process and set the roles. With the roles split, the boot log reads
   `registered 135 of 139` in the worker and `registered 20 of 139` in the HTTP process.

Rolling back never means reverting this PR: under `CRON_ROLE=all` its content is today's behaviour,
so what gets reset is configuration. See [What this PR bundles](#what-this-pr-bundles) for why a
revert is the expensive option.

## Testing

`npm test`, plus targeted runs on the affected suites; `tsc --noEmit`, ESLint and Prettier clean.
Coverage added by this branch:

- every rejected value for the role, including the empty string and the absent variable, asserting
  a throw rather than a silent default
- the `env -> Config` wiring the cron service actually reads, not just the parser
- registration per role: `all` registers everything, each role drops the other's scope, `both`
  survives in all three
- which jobs pass through the lease, and that a job declaring `timeout: 7200` still claims for 60
  seconds — the regression that made a deployment block a job for two hours
- shutdown: the lease survives a shutdown that outlasts the grace period, the shutdown does not
  return before the job does, `main.ts` is pinned to wire it to the signal at all, and pinned NOT
  to reach for `app.enableShutdownHooks()`
- an unusable lease table: reported at start-up, still reported on the next heartbeat when no new
  failure occurred, and reported healthy again once a claim gets through
- an api-scoped job losing the race is reported; a worker job losing it is not
- constraint naming across every migration, and the `cron_lease` entity against its own DDL
- the monitoring service: read path answers from the persisted state including the filtered
  queries, the merge prefers whichever value is newer, the write path keeps metrics another process
  wrote, the row is read under a write lock in the same transaction it writes in, an older
  measurement is not put back over a newer one, and the merge is retried only on errors a retry can
  resolve
- the monitoring state row: an environment whose state does not live under `id: 1` is answered from
  the row that exists, and the write seeds `id: 1` from it rather than with a partial state
- the statistic start-up fill: not in the worker, yes in `api` and `all`, off when the process flag
  is off, and a failure reported instead of left as an unhandled rejection
- the Spark wallet maintenance: registered as a job rather than a timer, scoped `worker`
- the guard against `@Cron(`, `@Interval(`, `@Timeout(` and `setInterval(`, including a check that
  its exception list still matches something

Every fix in the review rounds below was verified by putting the defect back and watching the test
fail, then restoring it.

## Known discrepancies, recorded rather than fixed

`ExchangeController::checkTrades` is **never registered**: its class is listed under `controllers:`
in `ExchangeModule` and nowhere under `providers:`, and `DiscoveryService.getProviders()` does not
return controllers, so the scan never sees the decorator. This predates the process split — the job
has never run. `TransactionController::checkLists` looks like the same case but is not:
`HistoryModule` lists that class under both `controllers:` and `providers:`, so the job is
registered, on the provider instance, which is a different object from the controller instance the
request handlers use.

`CitreaBaseStrategy::checkPayInEntries` is declared on an **abstract** class, so it is registered
once per concrete subclass rather than once per declaration. There is currently one subclass.

16 jobs carry no `process` flag. That is pre-existing, named in `docs/cron-jobs.md` as an omission
rather than hidden, and retrofitting it means introducing 16 new kill switches — a decision about
those jobs, not about this PR.

What should happen to any of these is a decision about the jobs, not about this inventory.

## Review rounds

**Round 1 — rebased** onto the current `develop`, conflict-free, CI 12/12 green.

**Round 2 — role heartbeat added.** `DfxCronService::reportRole` writes
`CronRole <role>: heartbeat, N jobs registered` in every process every ten minutes. The reason lies
outside this repository but the line originates here: the Grafana rule meant to report a wrong role
assignment used to read the boot line, which is written exactly once. On a healthy system a
counting window over it reports permanently from the day after the last deploy, because the line
falls out of the window while the container keeps running. And the most expensive state is
precisely the one without a restart: if the recreate for a configuration change does not happen,
the HTTP process keeps its old role while the worker takes over the same jobs. Without a restart
there is no new boot line, so the rule could not see it structurally. Scope `both` so the line
appears in every process, with the role *in* the line; no `process` flag, because a watchdog that
can be switched off looks, switched off, exactly like the failure it reports. `useDelay: false`,
because the alert reads a 12-minute window and the jitter is adjustable from outside through
`CRON_JOB_DELAY` — a watchdog must not have its timing tuned by a knob meant for spreading load.

**Round 3 — seven review points**, three implemented, four re-measured and declined with the
measurement stated. Implemented: the heartbeat tests were reading decorator metadata and would have
stayed green if the scan never saw the method, so the test now hands the scan its own service
instance the way Nest does and expects the heartbeat in the count; the guard test's `setTimeout`
gap was documented with its evidence; and the claim "behaviourally identical to today under
`CRON_ROLE=all`" was narrowed to what is actually true. Declined: the `git diff --check` whitespace
report (all files are CRLF and `.prettierrc` sets `endOfLine: auto`; two consecutive `develop`
commits report the same), the `PaymentCronService` scope (see above — the concern was right and is
now addressed by the lease and by reporting the lost race), the 16 missing flags, and the
"environment updates missing" point (they are in the infrastructure repository, because that is
where `CRON_ROLE` is set).

**Round 4 — the cross-process lease**, described above.

**Round 5 — a five-instance review of this PR and its three infrastructure counterparts.** Nine
findings here, all fixed on this branch: the lease TTL derived from the job timeout (up to a
two-hour outage per deployment) and the missing shutdown path; an unusable lease table looking like
a healthy process; a primary key name that violates the deterministic-naming rule; the missing
entity; timestamps without a time zone; the Spark maintenance timer and the statistic start-up fill
both running outside the scheduler and therefore outside the lease; the `api` scope contradicting
the lease; the monitoring read path depending on a row with `id: 1`; and this bundling, which is
named here rather than split out.
