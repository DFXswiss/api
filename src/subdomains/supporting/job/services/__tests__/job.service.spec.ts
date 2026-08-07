import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { MetricService } from 'src/shared/services/metric.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { IsNull } from 'typeorm';
import { JobAttempt } from '../../entities/job-attempt.entity';
import { Job } from '../../entities/job.entity';
import { JobAttemptOutcome, JobGroup, JobStatus } from '../../enums';
import { JobDeadLetterException } from '../../exceptions/job-dead-letter.exception';
import { JobHandler } from '../../interfaces/job-handler.interface';
import { JOB_GROUP_DEFAULTS } from '../../job-group.config';
import { JobAttemptRepository } from '../../repositories/job-attempt.repository';
import { JobRepository } from '../../repositories/job.repository';
import { JobService } from '../job.service';

describe('JobService', () => {
  let service: JobService;
  let jobRepo: JobRepository;
  let jobAttemptRepo: JobAttemptRepository;
  let settingService: SettingService;
  let metricService: MetricService;

  beforeEach(async () => {
    jobRepo = createMock<JobRepository>();
    jobAttemptRepo = createMock<JobAttemptRepository>();
    settingService = createMock<SettingService>();
    metricService = createMock<MetricService>();

    jest.spyOn(settingService, 'getObjCached').mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        JobService,
        { provide: JobRepository, useValue: jobRepo },
        { provide: JobAttemptRepository, useValue: jobAttemptRepo },
        { provide: SettingService, useValue: settingService },
        { provide: MetricService, useValue: metricService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<JobService>(JobService);
  });

  function createJob(partial: Partial<Job> = {}): Job {
    const job = new Job();
    job.id = partial.id ?? 1;
    job.uid = partial.uid ?? 'Jabc';
    job.group = partial.group ?? JobGroup.ACCOUNT_MERGE;
    job.status = partial.status ?? JobStatus.PENDING;
    job.idempotencyKey = partial.idempotencyKey ?? 'key-1';
    job.attempt = partial.attempt ?? 0;
    job.maxAttempts = partial.maxAttempts ?? JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE].maxAttempts;
    job.input = partial.input ?? JSON.stringify({ masterId: 1 });
    if (partial.output !== undefined) job.output = partial.output;
    if (partial.claimedAt !== undefined) job.claimedAt = partial.claimedAt;
    if (partial.claimedBy !== undefined) job.claimedBy = partial.claimedBy;
    if (partial.startedAt !== undefined) job.startedAt = partial.startedAt;
    if (partial.finishedAt !== undefined) job.finishedAt = partial.finishedAt;
    if (partial.nextAttemptAt !== undefined) job.nextAttemptAt = partial.nextAttemptAt;
    if (partial.error !== undefined) job.error = partial.error;
    return job;
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getConfig', () => {
    it('overrides only the provided field and keeps remaining defaults', async () => {
      jest.spyOn(settingService, 'getObjCached').mockResolvedValue([{ group: JobGroup.ACCOUNT_MERGE, maxAttempts: 7 }]);

      const config = await service.getConfig(JobGroup.ACCOUNT_MERGE);
      const defaults = JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE];

      expect(config).toEqual({
        maxWaitSeconds: defaults.maxWaitSeconds,
        maxRunSeconds: defaults.maxRunSeconds,
        maxAttempts: 7,
        exposeResult: defaults.exposeResult,
      });
    });
  });

  describe('enqueue', () => {
    it('creates a PENDING job with uid and maxAttempts from config when none exists', async () => {
      jest.spyOn(jobRepo, 'findOne').mockResolvedValue(undefined);
      jest.spyOn(jobRepo, 'create').mockImplementation((entity: Partial<Job>) => Object.assign(new Job(), entity));
      jest.spyOn(jobRepo, 'save').mockImplementation(async (entity: Job) => {
        entity.id = 42;
        return entity;
      });

      const result = await service.enqueue(JobGroup.ACCOUNT_MERGE, 'merge-1-2', { masterId: 1, slaveId: 2 }, {});

      expect(result.status).toBe(JobStatus.PENDING);
      expect(result.uid).toMatch(/^J/);
      expect(result.maxAttempts).toBe(JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE].maxAttempts);
      expect(result.group).toBe(JobGroup.ACCOUNT_MERGE);
      expect(result.idempotencyKey).toBe('merge-1-2');
      expect(result.inputData).toEqual({ masterId: 1, slaveId: 2 });
      expect(jobRepo.save).toHaveBeenCalled();
    });

    it('returns the existing job for the same group/idempotencyKey without saving', async () => {
      const existing = createJob({ id: 7, idempotencyKey: 'merge-1-2', status: JobStatus.PROCESSING });
      jest.spyOn(jobRepo, 'findOne').mockResolvedValue(existing);

      const result = await service.enqueue(JobGroup.ACCOUNT_MERGE, 'merge-1-2', { masterId: 1 }, {});

      expect(result).toBe(existing);
      expect(jobRepo.save).not.toHaveBeenCalled();
      expect(jobRepo.create).not.toHaveBeenCalled();
    });

    it('reloads the existing job on unique violation (23505) and does not throw', async () => {
      const existing = createJob({ id: 9, idempotencyKey: 'merge-1-2' });
      jest.spyOn(jobRepo, 'findOne').mockResolvedValueOnce(undefined).mockResolvedValueOnce(existing);
      jest.spyOn(jobRepo, 'create').mockImplementation((entity: Partial<Job>) => Object.assign(new Job(), entity));
      jest.spyOn(jobRepo, 'save').mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

      const result = await service.enqueue(JobGroup.ACCOUNT_MERGE, 'merge-1-2', { masterId: 1 }, {});

      expect(result).toBe(existing);
      expect(jobRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('re-throws non-unique save errors', async () => {
      jest.spyOn(jobRepo, 'findOne').mockResolvedValue(undefined);
      jest.spyOn(jobRepo, 'create').mockImplementation((entity: Partial<Job>) => Object.assign(new Job(), entity));
      jest.spyOn(jobRepo, 'save').mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));

      await expect(service.enqueue(JobGroup.ACCOUNT_MERGE, 'merge-1-2', { masterId: 1 }, {})).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('claimNext', () => {
    it('returns the job when the conditional update reports affected=1', async () => {
      const candidate = createJob({ id: 3, status: JobStatus.PENDING, attempt: 0 });
      jest.spyOn(jobRepo, 'find').mockResolvedValue([candidate]);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      const result = await service.claimNext(JobGroup.ACCOUNT_MERGE, 'worker-1');

      expect(result).toBe(candidate);
      expect(result.status).toBe(JobStatus.PROCESSING);
      expect(result.attempt).toBe(1);
      expect(result.claimedBy).toBe('worker-1');
      expect(jobRepo.update).toHaveBeenCalledWith(
        { id: 3, status: JobStatus.PENDING },
        expect.objectContaining({ status: JobStatus.PROCESSING, claimedBy: 'worker-1', attempt: 1 }),
      );
    });

    it('skips a first candidate with affected=0 and takes the second', async () => {
      const first = createJob({ id: 1, status: JobStatus.PENDING, attempt: 0 });
      const second = createJob({ id: 2, status: JobStatus.RETRY, attempt: 1 });
      jest.spyOn(jobRepo, 'find').mockResolvedValue([first, second]);
      jest
        .spyOn(jobRepo, 'update')
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] })
        .mockResolvedValueOnce({ affected: 1, raw: [], generatedMaps: [] });

      const result = await service.claimNext(JobGroup.ACCOUNT_MERGE, 'worker-1');

      expect(result).toBe(second);
      expect(result.status).toBe(JobStatus.PROCESSING);
      expect(result.attempt).toBe(2);
      expect(jobRepo.update).toHaveBeenCalledTimes(2);
    });

    it('returns undefined when find yields an empty list', async () => {
      jest.spyOn(jobRepo, 'find').mockResolvedValue([]);

      const result = await service.claimNext(JobGroup.ACCOUNT_MERGE, 'worker-1');

      expect(result).toBeUndefined();
      expect(jobRepo.update).not.toHaveBeenCalled();
    });

    it('creates exactly one attempt row with the winning attempt number and claimedBy', async () => {
      const candidate = createJob({ id: 30, status: JobStatus.PENDING, attempt: 0 });
      jest.spyOn(jobRepo, 'find').mockResolvedValue([candidate]);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(jobAttemptRepo, 'create').mockImplementation((entity) => Object.assign(new JobAttempt(), entity));
      const saveSpy = jest.spyOn(jobAttemptRepo, 'save').mockImplementation(async (entity) => entity as JobAttempt);

      const result = await service.claimNext(JobGroup.ACCOUNT_MERGE, 'worker-1');

      expect(result).toBe(candidate);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ job: candidate, attempt: 1, claimedBy: 'worker-1' }),
      );
    });

    it('creates no attempt row for a lost claim (affected: 0)', async () => {
      const candidate = createJob({ id: 31, status: JobStatus.PENDING, attempt: 0 });
      jest.spyOn(jobRepo, 'find').mockResolvedValue([candidate]);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      const saveSpy = jest.spyOn(jobAttemptRepo, 'save');

      const result = await service.claimNext(JobGroup.ACCOUNT_MERGE, 'worker-1');

      expect(result).toBeUndefined();
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('propagates the error and returns no job when writing the attempt row fails', async () => {
      const candidate = createJob({ id: 32, status: JobStatus.PENDING, attempt: 0 });
      jest.spyOn(jobRepo, 'find').mockResolvedValue([candidate]);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(jobAttemptRepo, 'create').mockImplementation((entity) => Object.assign(new JobAttempt(), entity));
      jest.spyOn(jobAttemptRepo, 'save').mockRejectedValue(new Error('insert failed'));

      await expect(service.claimNext(JobGroup.ACCOUNT_MERGE, 'worker-1')).rejects.toThrow('insert failed');
    });
  });

  describe('abort', () => {
    it('sets DEAD_LETTER for JobDeadLetterException without scheduling a retry', async () => {
      const job = createJob({ id: 5, status: JobStatus.PROCESSING, attempt: 1 });
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.abort(job, new JobDeadLetterException('broken input'));

      expect(job.status).toBe(JobStatus.DEAD_LETTER);
      expect(job.error).toBe('broken input');
      expect(job.finishedAt).toBeInstanceOf(Date);
      expect(job.nextAttemptAt).toBeUndefined();
      expect(jobRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 5,
          status: JobStatus.PROCESSING,
          attempt: job.attempt,
          claimedBy: job.claimedBy,
        }),
        expect.objectContaining({ status: JobStatus.DEAD_LETTER, error: 'broken input' }),
      );
    });

    it('sets RETRY with a future nextAttemptAt when attempts remain', async () => {
      const job = createJob({
        id: 6,
        status: JobStatus.PROCESSING,
        attempt: 1,
        maxAttempts: 3,
      });
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      const before = Date.now();
      await service.abort(job, new Error('transient'));

      expect(job.status).toBe(JobStatus.RETRY);
      expect(job.error).toBe('transient');
      expect(job.nextAttemptAt).toBeInstanceOf(Date);
      expect(job.nextAttemptAt.getTime()).toBeGreaterThan(before);
      expect(job.finishedAt).toBeUndefined();
    });

    it('sets FAILED without nextAttemptAt when attempts are exhausted', async () => {
      const job = createJob({
        id: 8,
        status: JobStatus.PROCESSING,
        attempt: 3,
        maxAttempts: 3,
      });
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.abort(job, new Error('still failing'));

      expect(job.status).toBe(JobStatus.FAILED);
      expect(job.error).toBe('still failing');
      expect(job.finishedAt).toBeInstanceOf(Date);
      expect(job.nextAttemptAt).toBeUndefined();
      expect(jobRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 8,
          status: JobStatus.PROCESSING,
          attempt: job.attempt,
          claimedBy: job.claimedBy,
        }),
        expect.objectContaining({ status: JobStatus.FAILED, error: 'still failing' }),
      );
    });

    it('skips the job update and does not throw when ownership is lost (affected: 0)', async () => {
      const job = createJob({
        id: 50,
        uid: 'Jlost-abort',
        status: JobStatus.PROCESSING,
        attempt: 1,
        maxAttempts: 3,
        claimedBy: 'worker-old',
      });
      jest.spyOn(jobAttemptRepo, 'findOne').mockResolvedValue(undefined);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

      await expect(service.abort(job, new Error('transient'))).resolves.toBeUndefined();

      expect(jobRepo.update).toHaveBeenCalledTimes(1);
      expect(jobRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 50,
          status: JobStatus.PROCESSING,
          attempt: job.attempt,
          claimedBy: job.claimedBy,
        }),
        expect.anything(),
      );
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('abort — attempt history', () => {
    it('closes the attempt row with outcome Failed and the full message for a plain error', async () => {
      const job = createJob({ id: 41, status: JobStatus.PROCESSING, attempt: 1, maxAttempts: 3 });
      const attemptRow = Object.assign(new JobAttempt(), {
        id: 100,
        job,
        attempt: 1,
        claimedBy: 'worker-1',
        claimedAt: new Date(),
      });
      jest.spyOn(jobAttemptRepo, 'findOne').mockResolvedValue(attemptRow);
      const attemptUpdateSpy = jest
        .spyOn(jobAttemptRepo, 'update')
        .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.abort(job, new Error('transient failure with full detail'));

      expect(attemptUpdateSpy).toHaveBeenCalledWith(
        100,
        expect.objectContaining({ outcome: JobAttemptOutcome.FAILED, error: 'transient failure with full detail' }),
      );
    });

    it('closes the attempt row with outcome DeadLetter for a JobDeadLetterException', async () => {
      const job = createJob({ id: 42, status: JobStatus.PROCESSING, attempt: 1 });
      const attemptRow = Object.assign(new JobAttempt(), {
        id: 101,
        job,
        attempt: 1,
        claimedBy: 'worker-1',
        claimedAt: new Date(),
      });
      jest.spyOn(jobAttemptRepo, 'findOne').mockResolvedValue(attemptRow);
      const attemptUpdateSpy = jest
        .spyOn(jobAttemptRepo, 'update')
        .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.abort(job, new JobDeadLetterException('broken input'));

      expect(attemptUpdateSpy).toHaveBeenCalledWith(
        101,
        expect.objectContaining({ outcome: JobAttemptOutcome.DEAD_LETTER, error: 'broken input' }),
      );
    });
  });

  describe('finish', () => {
    it('closes the attempt row with outcome Complete before writing the job snapshot', async () => {
      const job = createJob({ id: 40, status: JobStatus.PROCESSING, attempt: 1 });
      const attemptRow = Object.assign(new JobAttempt(), {
        id: 99,
        job,
        attempt: 1,
        claimedBy: 'worker-1',
        claimedAt: new Date(),
      });
      jest.spyOn(jobAttemptRepo, 'findOne').mockResolvedValue(attemptRow);
      const attemptUpdateSpy = jest
        .spyOn(jobAttemptRepo, 'update')
        .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
      const jobUpdateSpy = jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.finish(job, { done: true });

      expect(attemptUpdateSpy).toHaveBeenCalledWith(
        99,
        expect.objectContaining({ outcome: JobAttemptOutcome.COMPLETE }),
      );
      expect(jobUpdateSpy).toHaveBeenCalled();
      expect(attemptUpdateSpy.mock.invocationCallOrder[0]).toBeLessThan(jobUpdateSpy.mock.invocationCallOrder[0]);
    });

    it('skips the job update and does not throw when ownership is lost (affected: 0)', async () => {
      const job = createJob({
        id: 51,
        uid: 'Jlost-finish',
        status: JobStatus.PROCESSING,
        attempt: 1,
        claimedBy: 'worker-old',
      });
      jest.spyOn(jobAttemptRepo, 'findOne').mockResolvedValue(undefined);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();

      await expect(service.finish(job, { done: true })).resolves.toBeUndefined();

      expect(jobRepo.update).toHaveBeenCalledTimes(1);
      expect(jobRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 51,
          status: JobStatus.PROCESSING,
          attempt: job.attempt,
          claimedBy: job.claimedBy,
        }),
        expect.anything(),
      );
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('does not rewrite an already closed attempt row and still updates the job snapshot', async () => {
      const job = createJob({
        id: 52,
        uid: 'Jclosed-attempt',
        status: JobStatus.PROCESSING,
        attempt: 1,
        claimedBy: 'worker-1',
      });
      jest.spyOn(jobAttemptRepo, 'findOne').mockResolvedValue(undefined);
      const attemptUpdateSpy = jest.spyOn(jobAttemptRepo, 'update');
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.finish(job, { done: true });

      expect(jobAttemptRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ finishedAt: IsNull() }),
        }),
      );
      expect(attemptUpdateSpy).not.toHaveBeenCalled();
      expect(jobRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 52,
          status: JobStatus.PROCESSING,
          attempt: job.attempt,
          claimedBy: job.claimedBy,
        }),
        expect.anything(),
      );
    });
  });

  describe('registerHandler', () => {
    it('throws when a handler for the same group is already registered', () => {
      const handler: JobHandler = {
        group: JobGroup.ACCOUNT_MERGE,
        execute: async () => undefined,
      };

      service.registerHandler(handler);

      expect(() => service.registerHandler(handler)).toThrow(
        `Handler for job group ${JobGroup.ACCOUNT_MERGE} is already registered`,
      );
    });
  });

  describe('recoverStale', () => {
    it('moves a PROCESSING job with remaining attempts to RETRY', async () => {
      const job = createJob({
        id: 20,
        status: JobStatus.PROCESSING,
        attempt: 1,
        maxAttempts: 3,
        claimedAt: new Date(Date.now() - 60_000),
      });
      jest.spyOn(jobRepo, 'find').mockResolvedValue([job]);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      const recovered = await service.recoverStale(JobGroup.ACCOUNT_MERGE, 30);

      expect(recovered).toBe(1);
      expect(job.status).toBe(JobStatus.RETRY);
      expect(job.nextAttemptAt).toBeInstanceOf(Date);
      expect(jobRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: job.id, status: JobStatus.PROCESSING }),
        expect.objectContaining({ status: JobStatus.RETRY }),
      );
    });

    it('fails a PROCESSING job when the attempt budget is exhausted', async () => {
      const job = createJob({
        id: 21,
        status: JobStatus.PROCESSING,
        attempt: 3,
        maxAttempts: 3,
        claimedAt: new Date(Date.now() - 60_000),
      });
      jest.spyOn(jobRepo, 'find').mockResolvedValue([job]);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      const recovered = await service.recoverStale(JobGroup.ACCOUNT_MERGE, 30);

      expect(recovered).toBe(1);
      expect(job.status).toBe(JobStatus.FAILED);
      expect(job.finishedAt).toBeInstanceOf(Date);
      expect(job.error).toContain('Orphaned after restart');
      expect(job.error).toContain('3/3');
      expect(jobRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: job.id, status: JobStatus.PROCESSING }),
        expect.objectContaining({ status: JobStatus.FAILED }),
      );
    });

    it('does not mutate or log when the conditional update affects zero rows', async () => {
      const job = createJob({
        id: 22,
        status: JobStatus.PROCESSING,
        attempt: 1,
        maxAttempts: 3,
        claimedAt: new Date(Date.now() - 60_000),
      });
      const originalStatus = job.status;
      jest.spyOn(jobRepo, 'find').mockResolvedValue([job]);
      jest.spyOn(jobRepo, 'update').mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
      const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();
      const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

      const recovered = await service.recoverStale(JobGroup.ACCOUNT_MERGE, 30);

      expect(recovered).toBe(0);
      expect(job.status).toBe(originalStatus);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(jobRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: job.id, status: JobStatus.PROCESSING }),
        expect.objectContaining({ status: JobStatus.RETRY }),
      );

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
