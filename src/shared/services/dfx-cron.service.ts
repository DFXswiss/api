import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Config, CronRole } from 'src/config/config';
import { DisabledProcess } from 'src/shared/services/process.service';
import { CronScope, DFX_CRONJOB_PARAMS, DfxCron, DfxCronExpression, DfxCronParams } from 'src/shared/utils/cron';
import { LockClass } from 'src/shared/utils/lock';
import { CronLeaseService } from './cron-lease.service';
import { Util } from 'src/shared/utils/util';
import { CustomCronExpression } from '../utils/custom-cron-expression';
import { DfxLogger } from './dfx-logger';

/** Lease length for a job that declares no timeout of its own. */
const DEFAULT_LEASE_SECONDS = 300;

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
   */
  // `useDelay: false`: the alert reads this line over a 12-minute window. With the default jitter
  // the gap between two heartbeats can reach 660 s, leaving 60 s of margin — and the jitter is
  // configurable through CRON_JOB_DELAY, so someone could close that margin from the outside
  // without ever seeing this code. A watchdog must not have its own timing tuned by a knob meant
  // for spreading load.
  @DfxCron(CronExpression.EVERY_10_MINUTES, { scope: CronScope.BOTH, useDelay: false })
  reportRole(): void {
    this.logger.info(`CronRole ${Config.cronRole}: heartbeat, ${this.registeredCount} jobs registered`);
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
   * Wraps a job so that at most one process in the deployment runs it at a time.
   *
   * `lock` above only spans this process. Which process a job belongs to is decided by
   * configuration, and configuration can be wrong — a missed recreate leaves the old role in
   * place, `--scale` creates a second worker, a rollback puts two processes on `all`. In every
   * one of those the two processes hold separate locks and every payout runs twice. The lease
   * closes that by construction instead of reporting it a quarter of an hour later.
   *
   * `BOTH` jobs are deliberately exempt. They exist because a request path on THIS process reads
   * the state they maintain, so they have to run in every process — a lease over them would
   * starve whichever process lost the race, and the job would silently stop maintaining that
   * state. Their safety comes from a different property: running twice must be harmless by
   * construction, which is what CONTRIBUTING requires of them.
   */
  private guardAcrossProcesses(cronJobName: string, data: CronJobData): () => Promise<void> {
    const task = this.wrapFunction(data);

    if (data.params.scope === CronScope.BOTH) return task;

    // The lease has to outlive a single run, so it follows the job’s own timeout where there is
    // one. Where there is none the job carries no expectation of its duration either, and five
    // minutes is long enough that the renewal (every third of it) keeps a healthy run alive.
    const ttlSeconds = Number.isFinite(data.params.timeout) ? data.params.timeout : DEFAULT_LEASE_SECONDS;

    return () => this.leases.run(cronJobName, ttlSeconds, task);
  }

  private wrapFunction(data: CronJobData) {
    const context = { target: data.instance.constructor.name, method: data.methodName };

    return async (...args: any) => {
      if (data.params.process && DisabledProcess(data.params.process)) {
        this.logger.verbose(
          `Skipping ${context.target}::${context.method} - process ${data.params.process} is disabled`,
        );
        return;
      }

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
