import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { MetricService } from 'src/shared/services/metric.service';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { In, IsNull, LessThanOrEqual } from 'typeorm';
import { JobGroupSettingDto } from '../dto/job-group-setting.dto';
import { JobAttempt } from '../entities/job-attempt.entity';
import { Job } from '../entities/job.entity';
import { JobAttemptOutcome, JobGroup, JobStatus } from '../enums';
import { JobDeadLetterException } from '../exceptions/job-dead-letter.exception';
import { JobHandler } from '../interfaces/job-handler.interface';
import { JOB_GROUP_DEFAULTS, JobGroupConfig } from '../job-group.config';
import { JobAttemptRepository } from '../repositories/job-attempt.repository';
import { JobRepository } from '../repositories/job.repository';

@Injectable()
export class JobService {
  private readonly logger = new DfxLogger(JobService);
  private readonly handlers = new Map<JobGroup, JobHandler>();

  constructor(
    private readonly jobRepo: JobRepository,
    private readonly jobAttemptRepo: JobAttemptRepository,
    private readonly settingService: SettingService,
    private readonly metricService: MetricService,
  ) {}

  registerHandler(handler: JobHandler): void {
    if (this.handlers.has(handler.group)) {
      throw new Error(`Handler for job group ${handler.group} is already registered`);
    }

    this.handlers.set(handler.group, handler);
  }

  getHandler(group: JobGroup): JobHandler | undefined {
    return this.handlers.get(group);
  }

  async getConfig(group: JobGroup): Promise<JobGroupConfig> {
    const settings = await this.settingService.getObjCached<JobGroupSettingDto[]>('jobGroups');
    const defaults = JOB_GROUP_DEFAULTS[group];
    const override = settings?.find((s) => s.group === group);

    return {
      maxWaitSeconds: override?.maxWaitSeconds !== undefined ? override.maxWaitSeconds : defaults.maxWaitSeconds,
      maxRunSeconds: override?.maxRunSeconds !== undefined ? override.maxRunSeconds : defaults.maxRunSeconds,
      maxAttempts: override?.maxAttempts !== undefined ? override.maxAttempts : defaults.maxAttempts,
      exposeResult: override?.exposeResult !== undefined ? override.exposeResult : defaults.exposeResult,
    };
  }

  async findByIdempotencyKey(group: JobGroup, idempotencyKey: string): Promise<Job | undefined> {
    return this.jobRepo.findOne({ where: { group, idempotencyKey } });
  }

  async enqueue(
    group: JobGroup,
    idempotencyKey: string,
    input: unknown,
    options: { userData?: UserData; traceparent?: string },
  ): Promise<Job> {
    const existing = await this.findByIdempotencyKey(group, idempotencyKey);
    if (existing) return existing;

    const config = await this.getConfig(group);

    const job = this.jobRepo.create({
      uid: Util.createUid(Config.prefixes.jobUidPrefix),
      group,
      status: JobStatus.PENDING,
      idempotencyKey,
      attempt: 0,
      maxAttempts: config.maxAttempts,
      userData: options.userData,
      traceparent: options.traceparent,
    });
    job.inputData = input;

    try {
      const saved = await this.jobRepo.save(job);
      this.metricService.increment('dfx_job_enqueued', { group });
      return saved;
    } catch (e) {
      // Concurrent enqueue of the same group+idempotencyKey: unique index race.
      if ((e as { code?: string }).code !== '23505') throw e;

      const concurrent = await this.findByIdempotencyKey(group, idempotencyKey);
      if (!concurrent) throw e;
      return concurrent;
    }
  }

  // Conditional claim via status CAS: only one worker can win the update even across instances.
  // No time-window heuristic is required because two runners can never both process the same job.
  async claimNext(group: JobGroup, owner: string): Promise<Job | undefined> {
    const now = new Date();
    const candidates = await this.jobRepo.find({
      where: [
        { status: In([JobStatus.PENDING, JobStatus.RETRY]), group, nextAttemptAt: IsNull() },
        { status: In([JobStatus.PENDING, JobStatus.RETRY]), group, nextAttemptAt: LessThanOrEqual(now) },
      ],
      order: { id: 'ASC' },
      take: 10,
    });

    for (const candidate of candidates) {
      const previousStatus = candidate.status;
      const [, update] = candidate.claim(owner);
      const result = await this.jobRepo.update({ id: candidate.id, status: previousStatus }, update);

      if (result.affected === 1) {
        // The claim is a race that exactly one caller wins. Writing the attempt row before the conditional update
        // would leave every loser with a row describing an attempt it never actually took. Writing it here, right
        // after the win is confirmed, means the row always corresponds to a real attempt.
        //
        // If this insert fails, the error propagates (no try/catch): the `job` row already carries PROCESSING from
        // the update above, and there is no attempt row to prove work started. The only safe outcome is for the
        // job to sit in PROCESSING until recoverStale's staleness timeout picks it up again — not to swallow the
        // error and continue as if the attempt were properly recorded.
        const attemptRow: JobAttempt = this.jobAttemptRepo.create({
          job: candidate,
          attempt: candidate.attempt,
          claimedBy: candidate.claimedBy,
          claimedAt: candidate.claimedAt,
        });
        await this.jobAttemptRepo.save(attemptRow);

        return candidate;
      }
    }

    return undefined;
  }

  async recoverStale(group: JobGroup, staleAfterSeconds: number): Promise<number> {
    const cutoff = Util.secondsBefore(staleAfterSeconds);
    const staleJobs = await this.jobRepo.find({
      where: {
        status: JobStatus.PROCESSING,
        group,
        claimedAt: LessThanOrEqual(cutoff),
      },
    });

    let recovered = 0;

    for (const job of staleJobs) {
      const update: Partial<Job> =
        job.attempt >= job.maxAttempts
          ? {
              status: JobStatus.FAILED,
              finishedAt: new Date(),
              error: `Orphaned after restart, attempt budget exhausted (${job.attempt}/${job.maxAttempts})`,
            }
          : {
              status: JobStatus.RETRY,
              nextAttemptAt: new Date(),
            };

      // Same SELECT-then-conditional-UPDATE pattern as claimNext: a job that finished between
      // the find and this update must not be overwritten.
      const result = await this.jobRepo.update(
        { id: job.id, status: JobStatus.PROCESSING, claimedAt: LessThanOrEqual(cutoff) },
        update,
      );

      if (result.affected === 1) {
        Object.assign(job, update);
        // From this attempt's own point of view it failed by orphaning/timeout regardless of whether the job as a
        // whole goes on to RETRY or ends up FAILED — there is no RETRY outcome for an individual attempt, only
        // whether the job gets another one.
        await this.closeAttempt(
          job,
          JobAttemptOutcome.FAILED,
          `Orphaned: claim exceeded ${staleAfterSeconds}s without finishing, recovered by recoverStale`,
        );
        if (update.status === JobStatus.FAILED) {
          this.logger.error(
            `Failed stale job ${job.uid} (group ${job.group}, attempt ${job.attempt}/${job.maxAttempts}): attempt budget exhausted`,
          );
        } else {
          this.logger.warn(`Recovered stale job ${job.uid} (group ${job.group}, attempt ${job.attempt})`);
        }
        recovered += 1;
      }
    }

    return recovered;
  }

  async finish(job: Job, output: unknown): Promise<void> {
    await this.closeAttempt(job, JobAttemptOutcome.COMPLETE);

    const [, update] = job.complete(output);
    await this.updateJobIfOwned(job, update);
  }

  async abort(job: Job, error: Error): Promise<void> {
    if (error instanceof JobDeadLetterException) {
      await this.closeAttempt(job, JobAttemptOutcome.DEAD_LETTER, error.message);
      const [, update] = job.deadLetter(error.message);
      if (await this.updateJobIfOwned(job, update)) {
        this.logger.error(`Job ${job.id} dead-lettered:`, error);
      }
      return;
    }

    // Whichever branch the job itself takes below (another RETRY or a terminal FAILED), this attempt is over,
    // so its row is closed here, once, before either branch touches the `job` snapshot.
    await this.closeAttempt(job, JobAttemptOutcome.FAILED, error.message);

    if (job.attempt < job.maxAttempts) {
      const nextAttemptAt = Util.secondsAfter(this.backoff(job.attempt));
      const [, update] = job.fail(error.message, nextAttemptAt);
      await this.updateJobIfOwned(job, update);
      return;
    }

    const [, update] = job.fail(error.message, undefined);
    if (await this.updateJobIfOwned(job, update)) {
      this.logger.error(`Job ${job.id} failed after ${job.attempt} attempts:`, error);
    }
  }

  async getByUid(uid: string): Promise<Job | undefined> {
    return this.jobRepo.findOne({ where: { uid }, relations: { userData: true } });
  }

  // Deterministic backoff (seconds): attempt 1 → 10s, 2 → 30s, 3 → 120s, 4+ → 300s.
  private backoff(attempt: number): number {
    if (attempt === 1) return 10;
    if (attempt === 2) return 30;
    if (attempt === 3) return 120;
    return 300;
  }

  // Writes the job snapshot only if the row still belongs to the attempt this runner claimed. If
  // recoverStale has since reassigned the job to another runner (new attempt, new owner), the
  // affected count is 0 and this write is silently dropped — overwriting the new owner's state
  // here would let the handler run twice for the same job. The lost runner backs off; the new
  // owner is left to finish the job on its own.
  private async updateJobIfOwned(job: Job, update: Partial<Job>): Promise<boolean> {
    const result = await this.jobRepo.update(
      { id: job.id, status: JobStatus.PROCESSING, attempt: job.attempt, claimedBy: job.claimedBy },
      update,
    );

    if (result.affected === 0) {
      this.logger.warn(
        `Job ${job.uid} attempt ${job.attempt} (claimed by ${job.claimedBy}) no longer owns the job row — skipping update`,
      );
      return false;
    }

    return true;
  }

  // Closes the attempt row for the job's current attempt number. Called before every snapshot update on `job`
  // that concludes an attempt (finish, abort, recoverStale) — the immutable event must exist before the
  // denormalised current-state column changes, per the auditable-mutations rule.
  //
  // If no row is found, the process crashed between winning the claim and writing the attempt row in
  // claimNext. That gap is itself the documented outcome of a crash, not a new failure to raise here — the
  // `job` snapshot is still correct and must still receive its update, so this only logs and returns.
  private async closeAttempt(job: Job, outcome: JobAttemptOutcome, error?: string): Promise<void> {
    const attemptRow = await this.jobAttemptRepo.findOne({
      where: { job: { id: job.id }, attempt: job.attempt, finishedAt: IsNull() },
    });

    if (!attemptRow) {
      this.logger.warn(`No attempt row found for job ${job.uid}, attempt ${job.attempt}`);
      return;
    }

    await this.jobAttemptRepo.update(attemptRow.id, { finishedAt: new Date(), outcome, error });
  }
}
