import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { MetricService } from 'src/shared/services/metric.service';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { In, LessThanOrEqual } from 'typeorm';
import { JobGroup, JobPhase, JobStatus } from '../enums';
import { JobRepository } from '../repositories/job.repository';
import { JobService } from './job.service';

interface JobGroupSnapshot {
  group: JobGroup;
  pending: number;
  oldestPendingSeconds: number;
  overSlaWait: number;
  overSlaRun: number;
  deadLetter: number;
  maxWaitSeconds: number;
  maxRunSeconds: number;
}

const PENDING_STATUSES = [JobStatus.PENDING, JobStatus.RETRY];

@Injectable()
export class JobMetricService implements OnModuleInit {
  // Queue health is computed from the database, but not queried from the metrics export path: a
  // cron writes a snapshot into memory, and the gauge callbacks only read that snapshot. Gauge
  // callbacks run on the export cadence; a DB query inside them would tie the metrics export to
  // the database's response time.
  private snapshots = new Map<JobGroup, JobGroupSnapshot>();

  constructor(
    private readonly jobRepo: JobRepository,
    private readonly metricService: MetricService,
    private readonly jobService: JobService,
  ) {}

  onModuleInit(): void {
    this.metricService.registerGauge('dfx_job_pending', '1', (result) => {
      for (const snapshot of this.snapshots.values()) {
        result.observe(snapshot.pending, { group: snapshot.group });
      }
    });

    this.metricService.registerGauge('dfx_job_oldest_pending_seconds', 's', (result) => {
      for (const snapshot of this.snapshots.values()) {
        result.observe(snapshot.oldestPendingSeconds, { group: snapshot.group });
      }
    });

    // This gauge is necessary (as opposed to a counter incremented on completion) because it
    // reports a job that is CURRENTLY stuck WHILE it is stuck — a completion-time counter could
    // never do that, since a stuck job by definition has not completed.
    this.metricService.registerGauge('dfx_job_over_sla', '1', (result) => {
      for (const snapshot of this.snapshots.values()) {
        result.observe(snapshot.overSlaWait, { group: snapshot.group, phase: JobPhase.WAIT });
        result.observe(snapshot.overSlaRun, { group: snapshot.group, phase: JobPhase.RUN });
      }
    });

    this.metricService.registerGauge('dfx_job_sla_seconds', 's', (result) => {
      for (const snapshot of this.snapshots.values()) {
        result.observe(snapshot.maxWaitSeconds, { group: snapshot.group, phase: JobPhase.WAIT });
        result.observe(snapshot.maxRunSeconds, { group: snapshot.group, phase: JobPhase.RUN });
      }
    });

    this.metricService.registerGauge('dfx_job_dead_letter', '1', (result) => {
      for (const snapshot of this.snapshots.values()) {
        result.observe(snapshot.deadLetter, { group: snapshot.group });
      }
    });
  }

  // Both: this writes nothing — it refreshes the in-memory snapshot that this process's gauge
  // callbacks read, which is exactly the process-local state CronScope.BOTH exists for, and two
  // read-only sweeps are harmless. Worker-only would be worse than redundant: the gauge would then
  // exist only on the worker and disappear precisely when the worker is the thing that is stuck,
  // which is the case dfx_job_over_sla was built to report.
  @DfxCron(CronExpression.EVERY_30_SECONDS, {
    scope: CronScope.BOTH,
    process: Process.JOB_METRICS,
    timeout: 300,
  })
  async updateSnapshot(): Promise<void> {
    const next = new Map<JobGroup, JobGroupSnapshot>();

    for (const group of Object.values(JobGroup)) {
      const config = await this.jobService.getConfig(group);
      const waitCutoff = Util.secondsBefore(config.maxWaitSeconds);
      const runCutoff = Util.secondsBefore(config.maxRunSeconds);

      const pending = await this.jobRepo.countBy({
        group,
        status: In(PENDING_STATUSES),
      });

      const oldest = await this.jobRepo.findOne({
        where: { group, status: In(PENDING_STATUSES) },
        order: { created: 'ASC' },
      });
      const oldestPendingSeconds = oldest ? Util.secondsDiff(oldest.created) : 0;

      const overSlaWait = await this.jobRepo.countBy({
        group,
        status: In(PENDING_STATUSES),
        created: LessThanOrEqual(waitCutoff),
      });

      const overSlaRun = await this.jobRepo.countBy({
        group,
        status: JobStatus.PROCESSING,
        startedAt: LessThanOrEqual(runCutoff),
      });

      const deadLetter = await this.jobRepo.countBy({
        group,
        status: JobStatus.DEAD_LETTER,
      });

      next.set(group, {
        group,
        pending,
        oldestPendingSeconds,
        overSlaWait,
        overSlaRun,
        deadLetter,
        maxWaitSeconds: config.maxWaitSeconds,
        maxRunSeconds: config.maxRunSeconds,
      });
    }

    this.snapshots = next;
  }
}
