import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { MetricService } from 'src/shared/services/metric.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { Job } from '../../entities/job.entity';
import { JobGroup, JobStatus } from '../../enums';
import { JobHandler } from '../../interfaces/job-handler.interface';
import { JOB_GROUP_DEFAULTS } from '../../job-group.config';
import { JobDispatcherService } from '../job-dispatcher.service';
import { JobService } from '../job.service';

describe('JobDispatcherService', () => {
  let service: JobDispatcherService;
  let jobService: JobService;
  let metricService: MetricService;

  beforeEach(async () => {
    jobService = createMock<JobService>();
    metricService = createMock<MetricService>();

    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
    jest.spyOn(jobService, 'getConfig').mockResolvedValue(JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE]);
    jest.spyOn(jobService, 'recoverStale').mockResolvedValue(0);
    jest.spyOn(metricService, 'registerGauge').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        JobDispatcherService,
        { provide: JobService, useValue: jobService },
        { provide: MetricService, useValue: metricService },
      ],
    }).compile();

    service = module.get<JobDispatcherService>(JobDispatcherService);
  });

  function createJob(partial: Partial<Job> = {}): Job {
    const job = new Job();
    job.id = partial.id ?? 1;
    job.uid = partial.uid ?? 'Jabc';
    job.group = partial.group ?? JobGroup.ACCOUNT_MERGE;
    job.status = partial.status ?? JobStatus.PROCESSING;
    job.idempotencyKey = partial.idempotencyKey ?? 'key-1';
    job.attempt = partial.attempt ?? 1;
    job.maxAttempts = partial.maxAttempts ?? JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE].maxAttempts;
    job.input = partial.input ?? JSON.stringify({ masterId: 1 });
    job.created = partial.created ?? new Date(Date.now() - 5000);
    job.startedAt = partial.startedAt ?? new Date(Date.now() - 1000);
    if (partial.finishedAt !== undefined) job.finishedAt = partial.finishedAt;
    if (partial.traceparent !== undefined) job.traceparent = partial.traceparent;
    return job;
  }

  it('drain executes a claimed job and calls finish with the handler result', async () => {
    const job = createJob({ id: 1, uid: 'J1' });
    const handler: JobHandler = {
      group: JobGroup.ACCOUNT_MERGE,
      execute: jest.fn().mockResolvedValue({ masterId: 42 }),
    };

    jest.spyOn(jobService, 'getHandler').mockReturnValue(handler);
    jest.spyOn(jobService, 'claimNext').mockResolvedValueOnce(job).mockResolvedValueOnce(undefined);
    jest.spyOn(jobService, 'finish').mockImplementation(async (j, output) => {
      j.complete(output);
    });

    await service.drain(JobGroup.ACCOUNT_MERGE);

    expect(handler.execute).toHaveBeenCalledWith({ masterId: 1 });
    expect(jobService.finish).toHaveBeenCalledWith(job, { masterId: 42 });
    expect(jobService.finish).toHaveBeenCalledTimes(1);
    expect(jobService.claimNext).toHaveBeenCalledTimes(2);
  });

  it('handler failure calls abort and continues with the next job', async () => {
    const first = createJob({ id: 1, uid: 'J1' });
    const second = createJob({ id: 2, uid: 'J2', input: JSON.stringify({ masterId: 2 }) });
    const handlerError = new Error('transient');
    const handler: JobHandler = {
      group: JobGroup.ACCOUNT_MERGE,
      execute: jest.fn().mockRejectedValueOnce(handlerError).mockResolvedValueOnce({ ok: true }),
    };

    jest.spyOn(jobService, 'getHandler').mockReturnValue(handler);
    jest
      .spyOn(jobService, 'claimNext')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(undefined);
    jest.spyOn(jobService, 'abort').mockImplementation(async (j) => {
      j.fail('transient', new Date(Date.now() + 10000));
    });
    jest.spyOn(jobService, 'finish').mockImplementation(async (j, output) => {
      j.complete(output);
    });

    await service.drain(JobGroup.ACCOUNT_MERGE);

    expect(jobService.abort).toHaveBeenCalledWith(first, handlerError);
    expect(jobService.finish).toHaveBeenCalledWith(second, { ok: true });
    expect(handler.execute).toHaveBeenCalledTimes(2);
    expect(jobService.claimNext).toHaveBeenCalledTimes(3);
  });

  it('missing handler does not claim jobs and logs an error', async () => {
    jest.spyOn(jobService, 'getHandler').mockReturnValue(undefined);
    const claimNext = jest.spyOn(jobService, 'claimNext');
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

    await service.drain(JobGroup.ACCOUNT_MERGE);

    expect(claimNext).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(`No handler registered for job group ${JobGroup.ACCOUNT_MERGE}`);
    errorSpy.mockRestore();
  });

  it('drain calls recoverStale with double maxRunSeconds', async () => {
    const config = JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE];
    jest.spyOn(jobService, 'getHandler').mockReturnValue({
      group: JobGroup.ACCOUNT_MERGE,
      execute: async () => undefined,
    });
    jest.spyOn(jobService, 'claimNext').mockResolvedValue(undefined);

    await service.drain(JobGroup.ACCOUNT_MERGE);

    expect(jobService.recoverStale).toHaveBeenCalledWith(JobGroup.ACCOUNT_MERGE, config.maxRunSeconds * 2);
  });

  it('drain claims nothing and does not call the handler when the group process is disabled', async () => {
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);
    const handler: JobHandler = {
      group: JobGroup.ACCOUNT_MERGE,
      execute: jest.fn(),
    };
    jest.spyOn(jobService, 'getHandler').mockReturnValue(handler);
    const claimNext = jest.spyOn(jobService, 'claimNext');
    const recoverStale = jest.spyOn(jobService, 'recoverStale');
    const getConfig = jest.spyOn(jobService, 'getConfig');

    await service.drain(JobGroup.ACCOUNT_MERGE);

    expect(claimNext).not.toHaveBeenCalled();
    expect(handler.execute).not.toHaveBeenCalled();
    expect(recoverStale).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('stops at 100 jobs and logs a warning when the drain cap is hit', async () => {
    const handler: JobHandler = {
      group: JobGroup.ACCOUNT_MERGE,
      execute: jest.fn().mockResolvedValue({ ok: true }),
    };
    jest.spyOn(jobService, 'getHandler').mockReturnValue(handler);
    jest.spyOn(jobService, 'claimNext').mockImplementation(async () => createJob());
    jest.spyOn(jobService, 'finish').mockImplementation(async (j, output) => {
      j.complete(output);
    });
    const warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();

    await service.drain(JobGroup.ACCOUNT_MERGE);

    expect(jobService.claimNext).toHaveBeenCalledTimes(100);
    expect(handler.execute).toHaveBeenCalledTimes(100);
    expect(warnSpy).toHaveBeenCalledWith(
      `Job drain cap reached for group ${JobGroup.ACCOUNT_MERGE}: processed 100 jobs in one drain`,
    );
    warnSpy.mockRestore();
  });

  it('counts dfx_job_finished complete when finished, and does not count failed when abort leaves RETRY', async () => {
    const completeJob = createJob({ id: 1, uid: 'Jcomplete' });
    const retryJob = createJob({ id: 2, uid: 'Jretry' });
    const handler: JobHandler = {
      group: JobGroup.ACCOUNT_MERGE,
      execute: jest.fn().mockResolvedValueOnce({ done: true }).mockRejectedValueOnce(new Error('retry me')),
    };

    jest.spyOn(jobService, 'getHandler').mockReturnValue(handler);
    jest
      .spyOn(jobService, 'claimNext')
      .mockResolvedValueOnce(completeJob)
      .mockResolvedValueOnce(retryJob)
      .mockResolvedValueOnce(undefined);
    jest.spyOn(jobService, 'finish').mockImplementation(async (j, output) => {
      j.complete(output);
    });
    jest.spyOn(jobService, 'abort').mockImplementation(async (j, error) => {
      j.fail(error.message, new Date(Date.now() + 10000));
    });

    await service.drain(JobGroup.ACCOUNT_MERGE);

    expect(metricService.increment).toHaveBeenCalledWith('dfx_job_finished', {
      group: JobGroup.ACCOUNT_MERGE,
      outcome: 'complete',
    });
    expect(metricService.increment).not.toHaveBeenCalledWith('dfx_job_finished', {
      group: JobGroup.ACCOUNT_MERGE,
      outcome: 'failed',
    });
    expect(metricService.increment).not.toHaveBeenCalledWith('dfx_job_finished', {
      group: JobGroup.ACCOUNT_MERGE,
      outcome: 'dead_letter',
    });
    expect(metricService.increment).toHaveBeenCalledTimes(1);
  });

  it('propagates finish persistence failures without counting dfx_job_finished complete', async () => {
    const job = createJob({ id: 3, uid: 'Jpersist' });
    const handler: JobHandler = {
      group: JobGroup.ACCOUNT_MERGE,
      execute: jest.fn().mockResolvedValue({ done: true }),
    };
    const persistError = new Error('connection lost');

    jest.spyOn(jobService, 'getHandler').mockReturnValue(handler);
    jest.spyOn(jobService, 'claimNext').mockResolvedValueOnce(job).mockResolvedValueOnce(undefined);
    jest.spyOn(jobService, 'finish').mockRejectedValue(persistError);
    const errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();

    await expect(service.drain(JobGroup.ACCOUNT_MERGE)).rejects.toThrow('connection lost');

    expect(metricService.increment).not.toHaveBeenCalledWith('dfx_job_finished', {
      group: JobGroup.ACCOUNT_MERGE,
      outcome: 'complete',
    });
    expect(errorSpy).toHaveBeenCalledWith(`Failed to persist result for job ${job.uid}:`, persistError);

    errorSpy.mockRestore();
  });
});
