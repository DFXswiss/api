import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Config, CronRole } from 'src/config/config';
import { DisabledProcess } from 'src/shared/services/process.service';
import { CronScope, DFX_CRONJOB_PARAMS, DfxCron, DfxCronExpression, DfxCronParams } from 'src/shared/utils/cron';
import { LockClass } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CustomCronExpression } from '../utils/custom-cron-expression';
import { CronLeaseService } from './cron-lease.service';
import { DfxLogger } from './dfx-logger';

interface CronJobData {
  instance: object;
  methodRef: any;
  methodName: string;
  params: DfxCronParams;
}

@Injectable()
export class DfxCronService implements OnModuleInit {
  private readonly logger = new DfxLogger(DfxCronService);

  private registeredCount = 0;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly schedulerRegisty: SchedulerRegistry,
    private readonly leases: CronLeaseService,
  ) {}

  onModuleInit() {
    const registered: CronScope[] = [];
    let skipped = 0;

    this.discovery
      .getProviders()
      .filter((wrapper) => wrapper.isDependencyTreeStatic())
      .filter(({ instance }) => instance && Object.getPrototypeOf(instance))
      .forEach(({ instance }) => {
        this.metadataScanner
          .getAllMethodNames(instance)
          .map((methodName) => {
            const methodRef = instance[methodName];

            return {
              instance,
              methodRef,
              methodName,
              params: Reflect.getMetadata(DFX_CRONJOB_PARAMS, methodRef),
            };
          })
          .filter((data) => data.params)
          .forEach((data) => {
            if (!this.runsInThisRole(data.params.scope)) {
              skipped++;
              return;
            }

            registered.push(data.params.scope);
            this.addCronJob(data);
          });
      });

    // Counts what this process actually registered, which is not the same as counting decorators
    // in the source: a job declared on an abstract base class is registered once per concrete
    // provider, and the filter above skips providers whose dependency tree is not static. Stays
    // on `info` so the split is readable without changing the log level.
    const total = registered.length + skipped;
    const byScope = Object.values(CronScope)
      .map((scope) => `${scope}: ${registered.filter((s) => s === scope).length}`)
      .join(', ');

    this.registeredCount = registered.length;

    this.logger.info(`CronRole ${Config.cronRole}: registered ${registered.length} of ${total} jobs (${byScope})`);

    // And a heartbeat right away, not only at the next ten-minute mark. The line above is a
    // DIFFERENT one — the alerts read the heartbeat, and a process that has just started would
    // otherwise be missing from it for up to ten minutes.
    //
    // That is not a theoretical gap: the job fires on fixed marks (`useDelay: false`), so a
    // process that comes up at :11 and misses :10 writes nothing until :20. Against a
    // twelve-minute window, an ordinary deploy could then produce the "worker is silent" alarm —
    // the critical one this whole split rests on.
    this.reportRole();
  }

  /**
   * The line above says which role this process STARTED with. It cannot answer whether the two
   * processes are running the right roles right now: it is written once, so an alert built on a
   * counting window over it either reports nothing after the window passes, or reports permanently.
   * This line answers the same question continuously, and the alert reads it.
   *
   * Deliberately `both`: it has to appear in EVERY process, and it carries the role, so a swapped
   * assignment shows up as a wrong role rather than only as a missing line.
   *
   * Deliberately without a `process` flag: a watchdog that can be switched off looks, once it is
   * off, exactly like a process that stopped writing the line — the alert could not tell the two
   * apart. The job holds no state and does nothing but log, so there is nothing to switch off.
   *
   * The line is written to be read by a machine, in exactly one of two shapes:
   *
   * ```
   * CronRole <role>: heartbeat, <n> jobs registered, lease ok
   * CronRole <role>: heartbeat, <n> jobs registered, lease unusable: <n> failure(s) since the last heartbeat, last error: <reason>
   * ```
   *
   * Three properties make that safe to match on, and all three are load-bearing. One of `lease ok`
   * or `lease unusable` is ALWAYS present, so a reader sees the current state rather than having
   * to count occurrences of a line that only appears when something is wrong — a count over a
   * window cannot tell "healthy" from "not reporting at all". Neither literal is a prefix of the
   * other. And the only free text — the reason — comes last, so every matched field sits at a
   * fixed distance from the START of the line and no input can push one of them there.
   *
   * That last property is what a matcher has to be written to use: anchor at the start of the
   * line, not at its end. The end of an unhealthy line is caller-supplied text, so a selector
   * anchored there is deciding on a value the failure itself gets to choose.
   *
   * `__tests__/dfx-cron.service.spec.ts` pins both shapes; changing the wording here fails there.
   */
  // `useDelay: false`: the alert reads this line over a 12-minute window. With the default jitter
  // the gap between two heartbeats can reach 660 s, leaving 60 s of margin — and the jitter is
  // configurable through CRON_JOB_DELAY, so someone could close that margin from the outside
  // without ever seeing this code. A watchdog must not have its own timing tuned by a knob meant
  // for spreading load.
  @DfxCron(CronExpression.EVERY_10_MINUTES, { scope: CronScope.BOTH, useDelay: false })
  reportRole(): void {
    const line = `CronRole ${Config.cronRole}: heartbeat, ${this.registeredCount} jobs registered`;
    const lease = this.leases.takeFailures();

    // What the lease layer costs when it is broken depends on the role, and neither case says so
    // by itself: under `api`/`worker` the jobs are skipped, and a skip looks exactly like a job
    // with nothing to do; under `all` they run without a claim, which looks like nothing at all.
    // This job is scope `both` and therefore exempt from the lease itself, so it keeps reporting
    // in both cases — a count of REGISTERED jobs sees neither.
    if (lease.healthy) return this.logger.info(`${line}, lease ok`);

    this.logger.error(
      `${line}, lease unusable: ${lease.count} failure(s) since the last heartbeat, last error: ${
        lease.last ?? 'unknown'
      }`,
    );
  }

  /**
   * `all` runs everything, which is the single-process mode. The other two roles each run their
   * own scope plus `both`, so a job maintaining process-local state that requests read is
   * registered in every process.
   */
  private runsInThisRole(scope: CronScope): boolean {
    switch (Config.cronRole) {
      case CronRole.ALL:
        return true;

      case CronRole.API:
        return scope === CronScope.API || scope === CronScope.BOTH;

      case CronRole.WORKER:
        return scope === CronScope.WORKER || scope === CronScope.BOTH;
    }
  }

  private addCronJob(data: CronJobData) {
    const lock = LockClass.create(data.params.timeout ?? Infinity);

    const context = { target: data.instance.constructor.name, method: data.methodName };
    const cronJobName = `${context.target}::${context.method}`;
    const run = this.guardAcrossProcesses(cronJobName, data);
    const cronJob = new CronJob(data.params.expression, () => lock(run, context));

    this.schedulerRegisty.addCronJob(cronJobName, cronJob);
    cronJob.start();

    this.logger.verbose(`Registered ${cronJobName} (${data.params.scope})`);
  }

  /**
   * Wraps a job in the lease, so a second process has to claim it before it can start the job.
   *
   * `lock` above only spans this process. Which process a job belongs to is decided by
   * configuration, and configuration can be wrong — a missed recreate leaves the old role in
   * place, `--scale` creates a second worker, a rollback puts two processes on `all`. In every
   * one of those the two processes hold separate locks and every payout runs twice, for as long as
   * it takes someone to notice. With the lease, the second process has to take the claim before it
   * may start the job, and while the holder keeps renewing it never gets one. It does not rule a
   * double run out, and it does not bound how long one lasts — CronLeaseService says under "What
   * it does not do" exactly where it stops — so the jobs still have to tolerate a repeat.
   *
   * `BOTH` jobs are deliberately exempt. They exist because a request path on THIS process reads
   * the state they maintain, so they have to run in every process — a lease over them would
   * starve whichever process lost the race, and the job would silently stop maintaining that
   * state. Their safety comes from a different property: running twice must be harmless by
   * construction, which is what CONTRIBUTING requires of them.
   *
   * `API` jobs are leased as well, and reported when they lose the race. Their scope says their
   * effect is confined to the process running them, which is an argument for every API process
   * running them; the lease is what keeps one that also writes or calls out from
   * routinely doing either twice. Where the two pull apart the lease wins, and the process that lost the race is left
   * without whatever the job maintains — which is why an `API` job must not be the only thing
   * filling what a request path reads, and why delivering to connections belongs to a `BOTH` job
   * driven from stored state rather than to this scope. Losing the race is reported rather than
   * passed over, because for these jobs it is the symptom of a deployment running more than one
   * API process rather than a normal cycle.
   */
  private guardAcrossProcesses(cronJobName: string, data: CronJobData): () => Promise<void> {
    const task = this.wrapFunction(data);

    const leased =
      data.params.scope === CronScope.BOTH
        ? task
        : () => this.leases.run(cronJobName, task, data.params.scope === CronScope.API);

    // OUTSIDE the lease, and that order is the point: a job that is switched off must not claim
    // anything. Inside, every tick of a disabled job still cost one INSERT and one DELETE on
    // `cron_lease` — for the jobs that tick every second, two statements a second each, and under
    // `DISABLED_PROCESSES='*'` for all of them at once. That is dead tuples on a table whose whole
    // purpose is to be read quickly, produced by jobs that are doing nothing.
    return this.skipWhenDisabled(leased, data);
  }

  private skipWhenDisabled(task: () => Promise<void>, data: CronJobData): () => Promise<void> {
    const { process } = data.params;
    if (!process) return task;

    const context = { target: data.instance.constructor.name, method: data.methodName };

    return async () => {
      if (DisabledProcess(process)) {
        this.logger.verbose(`Skipping ${context.target}::${context.method} - process ${process} is disabled`);
        return;
      }

      return task();
    };
  }

  private wrapFunction(data: CronJobData) {
    return async (...args: any) => {
      if (data.params.useDelay ?? true) await this.cronJobDelay(data.params.expression);

      await data.methodRef.apply(data.instance, args);
    };
  }

  private async cronJobDelay(expression: DfxCronExpression): Promise<void> {
    const random = Math.random() * 1000;

    const delays = Config.cronJobDelay;

    switch (expression) {
      case CronExpression.EVERY_10_SECONDS:
        return Util.delay(random * (delays[0] ?? 5));

      case CustomCronExpression.EVERY_15_SECONDS:
        return Util.delay(random * (delays[1] ?? 5));

      case CronExpression.EVERY_30_SECONDS:
        return Util.delay(random * (delays[2] ?? 15));

      case CronExpression.EVERY_MINUTE:
        return Util.delay(random * (delays[3] ?? 30));

      case CronExpression.EVERY_5_MINUTES:
        return Util.delay(random * (delays[4] ?? 60));

      case CronExpression.EVERY_10_MINUTES:
        return Util.delay(random * (delays[5] ?? 60));

      case CustomCronExpression.EVERY_15_MINUTES:
        return Util.delay(random * (delays[6] ?? 60));

      case CronExpression.EVERY_HOUR:
        return Util.delay(random * (delays[7] ?? 120));
    }
  }
}
