import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Job } from '../entities/job.entity';
import { JobGroup, JobStatus } from '../enums';
import { JobController } from '../job.controller';
import { JOB_GROUP_DEFAULTS, JobGroupConfig } from '../job-group.config';
import { JobService } from '../services/job.service';

describe('JobController', () => {
  let controller: JobController;
  let jobService: JobService;

  beforeEach(async () => {
    jobService = createMock<JobService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      controllers: [JobController],
      providers: [{ provide: JobService, useValue: jobService }],
    }).compile();

    controller = module.get<JobController>(JobController);
  });

  function createJob(partial: Partial<Job> & { userData?: UserData } = {}): Job {
    const job = new Job();
    job.id = partial.id ?? 1;
    job.uid = partial.uid ?? 'Jabc';
    job.group = partial.group ?? JobGroup.ACCOUNT_MERGE;
    job.status = partial.status ?? JobStatus.COMPLETE;
    job.idempotencyKey = partial.idempotencyKey ?? 'key-1';
    job.attempt = partial.attempt ?? 1;
    job.maxAttempts = partial.maxAttempts ?? 3;
    job.input = partial.input ?? JSON.stringify({ masterId: 1 });
    job.created = partial.created ?? new Date('2026-01-01T00:00:00.000Z');
    if (partial.output !== undefined) job.output = partial.output;
    if (partial.startedAt !== undefined) job.startedAt = partial.startedAt;
    if (partial.finishedAt !== undefined) job.finishedAt = partial.finishedAt;
    if (partial.error !== undefined) job.error = partial.error;
    if (partial.userData !== undefined) job.userData = partial.userData;
    return job;
  }

  function jwtForAccount(account: number): JwtPayload {
    return { account, role: UserRole.USER, ip: '127.0.0.1' };
  }

  it('throws NotFoundException when the job belongs to a different account', async () => {
    const owner = { id: 10 } as UserData;
    const job = createJob({ uid: 'Jsecret', userData: owner });
    jest.spyOn(jobService, 'getByUid').mockResolvedValue(job);

    await expect(controller.getJob(jwtForAccount(99), 'Jsecret')).rejects.toThrow(NotFoundException);
    await expect(controller.getJob(jwtForAccount(99), 'Jsecret')).rejects.toThrow('Job not found');
    expect(jobService.getConfig).not.toHaveBeenCalled();
  });

  it('omits result when exposeResult is false and includes it when true and status is COMPLETE', async () => {
    const job = createJob({
      uid: 'Jresult',
      status: JobStatus.COMPLETE,
      output: JSON.stringify({ masterId: 7 }),
      finishedAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    jest.spyOn(jobService, 'getByUid').mockResolvedValue(job);

    const hiddenConfig: JobGroupConfig = {
      ...JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE],
      exposeResult: false,
    };
    jest.spyOn(jobService, 'getConfig').mockResolvedValue(hiddenConfig);

    const hidden = await controller.getJob(undefined, 'Jresult');
    expect(hidden).toEqual(
      expect.objectContaining({
        uid: 'Jresult',
        group: JobGroup.ACCOUNT_MERGE,
        status: JobStatus.COMPLETE,
        expectedSeconds: hiddenConfig.maxWaitSeconds + hiddenConfig.maxRunSeconds,
      }),
    );
    // The serialized response is checked, because that is what the client sees: the class
    // property `result` exists structurally (declared fields become own properties with value
    // `undefined` when `new JobDto()` runs under target es2023), but carries no value here and
    // is dropped by `JSON.stringify`.
    expect(JSON.parse(JSON.stringify(hidden))).not.toHaveProperty('result');
    expect(hidden.result).toBeUndefined();

    const exposedConfig: JobGroupConfig = {
      ...JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE],
      exposeResult: true,
    };
    jest.spyOn(jobService, 'getConfig').mockResolvedValue(exposedConfig);

    const exposed = await controller.getJob(undefined, 'Jresult');
    expect(JSON.parse(JSON.stringify(exposed))).toHaveProperty('result');
    expect(exposed.result).toEqual({ masterId: 7 });
    expect(exposed).toEqual(
      expect.objectContaining({
        uid: 'Jresult',
        status: JobStatus.COMPLETE,
        result: { masterId: 7 },
      }),
    );
  });
});
