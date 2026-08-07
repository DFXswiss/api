import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ROOT_CONTEXT, SpanStatusCode, propagation, trace } from '@opentelemetry/api';
import { hostname } from 'os';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { MetricService } from 'src/shared/services/metric.service';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { Job } from '../entities/job.entity';
import { JobGroup } from '../enums';
import { JobDeadLetterException } from '../exceptions/job-dead-letter.exception';
import { JobHandler } from '../interfaces/job-handler.interface';
import { JOB_GROUP_PROCESS } from '../job-group.config';
import { JobService } from './job.service';

const MAX_JOBS_PER_DRAIN = 100;

@Injectable()
export class JobDispatcherService implements OnModuleInit {
  private readonly logger = new DfxLogger(JobDispatcherService);
  // Identifies the claim owner so an orphaned claim can be reassigned to a different runner after a restart.
  private readonly owner = `${hostname()}:${process.pid}`;
  private readonly lastRunAt = new Map<JobGroup, Date>();

  constructor(
    private readonly jobService: JobService,
    private readonly metricService: MetricService,
  ) {
    const now = new Date();
    for (const group of Object.values(JobGroup)) {
      this.lastRunAt.set(group, now);
    }
  }

  onModuleInit(): void {
    this.metricService.registerGauge('dfx_job_seconds_since_last_run', 's', (result) => {
      for (const group of Object.values(JobGroup)) {
        const lastRunAt = this.lastRunAt.get(group);
        if (lastRunAt === undefined) continue;
        result.observe(Util.secondsDiff(lastRunAt), { group });
      }
    });
  }

  // Kicking right after a job is created brings the wait time down to effectively zero; the cron
  // below is the safety net in case the kick is lost (process restart, a second instance, an error
  // inside the kick itself) — the delivery guarantee must NOT depend on the kick.
  kick(group: JobGroup): void {
    void this.drain(group).catch((e) => {
      const error = e instanceof Error ? e : new Error(String(e));
      this.logger.error(`Failed to drain job group ${group}:`, error);
    });
  }

  async drain(group: JobGroup): Promise<void> {
    // Named jobProcess, not process: the class uses Node's global `process` for the owner id.
    const jobProcess = JOB_GROUP_PROCESS[group];
    if (DisabledProcess(jobProcess)) {
      this.logger.verbose(`Skipping job drain for group ${group} - process ${jobProcess} is disabled`);
      return;
    }

    const config = await this.jobService.getConfig(group);
    // Threshold is derived (maxRunSeconds * 2) rather than a separate config knob: one fewer
    // setting to configure and keep in sync.
    await this.jobService.recoverStale(group, config.maxRunSeconds * 2);

    const handler = this.jobService.getHandler(group);
    if (!handler) {
      // A missing handler is a deployment/wiring bug, not an unworkable task; the queue should
      // visibly grow rather than silently discarding jobs.
      this.logger.error(`No handler registered for job group ${group}`);
      return;
    }

    let processed = 0;
    for (;;) {
      if (processed >= MAX_JOBS_PER_DRAIN) {
        this.logger.warn(`Job drain cap reached for group ${group}: processed ${MAX_JOBS_PER_DRAIN} jobs in one drain`);
        break;
      }

      const job = await this.jobService.claimNext(group, this.owner);
      if (!job) break;

      processed += 1;
      await this.executeJob(handler, job);
    }

    // Heartbeat attests that the sweep ran, not that there was work to do.
    this.lastRunAt.set(group, new Date());
  }

  // Worker: the sweep claims rows, runs the merge and writes its outcome — the definition of
  // driving business forward. The claim is safe across processes on its own, but scoping it here
  // keeps the long-running work off the process that answers requests, which is the point of the
  // role split.
  @DfxCron(CronExpression.EVERY_MINUTE, {
    scope: CronScope.WORKER,
    process: Process.JOB_ACCOUNT_MERGE,
    timeout: 1800,
  })
  async sweepAccountMerge(): Promise<void> {
    await this.drain(JobGroup.ACCOUNT_MERGE);
  }

  private async executeJob(handler: JobHandler, job: Job): Promise<void> {
    // Keeps the incoming request and the later job execution in the same trace — without it,
    // nothing would show what happened to a job after the request already returned 202.
    const tracer = trace.getTracer('dfx-api');
    const ctx = job.traceparent ? propagation.extract(ROOT_CONTEXT, { traceparent: job.traceparent }) : ROOT_CONTEXT;

    await tracer.startActiveSpan(`job ${job.group}`, {}, ctx, async (span) => {
      try {
        span.setAttributes({
          'job.uid': job.uid,
          'job.group': job.group,
          'job.attempt': job.attempt,
        });

        let handlerError: Error | undefined;
        let output: unknown;

        try {
          output = await handler.execute(job.inputData);
        } catch (e) {
          handlerError = e instanceof Error ? e : new Error(String(e));
        }

        if (handlerError) {
          span.recordException(handlerError);
          span.setStatus({ code: SpanStatusCode.ERROR });

          try {
            if (!job.isFinished) {
              await this.jobService.abort(job, handlerError);
            }
          } catch (e) {
            // Persistence failure: abort never landed. Re-throw so callers see an untrustworthy
            // data state instead of a terminal job outcome that the database never recorded.
            const abortError = e instanceof Error ? e : new Error(String(e));
            this.logger.error(`Failed to persist abort for job ${job.uid}:`, abortError);
            throw abortError;
          }

          if (job.isFinished) {
            const outcome = handlerError instanceof JobDeadLetterException ? 'dead_letter' : 'failed';
            this.metricService.increment('dfx_job_finished', { group: job.group, outcome });
          }
        } else {
          try {
            await this.jobService.finish(job, output);
          } catch (e) {
            // Persistence failure: the database does not reflect the outcome we computed. Logging
            // it as a terminal metric would claim a completion the database never recorded, so it
            // is logged and re-thrown. Wait/run/total metrics below are skipped because the data
            // is no longer trustworthy from this point.
            const error = e instanceof Error ? e : new Error(String(e));
            this.logger.error(`Failed to persist result for job ${job.uid}:`, error);
            throw error;
          }

          if (job.isFinished) {
            this.metricService.increment('dfx_job_finished', { group: job.group, outcome: 'complete' });
          }
        }

        const waitSeconds = job.waitSeconds;
        if (waitSeconds !== undefined) {
          this.metricService.record('dfx_job_wait_seconds', waitSeconds, 's', { group: job.group });
        }

        const runSeconds = job.runSeconds;
        if (runSeconds !== undefined) {
          this.metricService.record('dfx_job_run_seconds', runSeconds, 's', { group: job.group });
        }

        const totalSeconds = job.totalSeconds;
        if (totalSeconds !== undefined) {
          this.metricService.record('dfx_job_total_seconds', totalSeconds, 's', { group: job.group });
        }
      } finally {
        span.end();
      }
    });
  }
}
