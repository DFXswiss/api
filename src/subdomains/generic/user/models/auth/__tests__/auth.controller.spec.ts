import { createMock } from '@golevelup/ts-jest';
import { ConflictException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { Job } from 'src/subdomains/supporting/job/entities/job.entity';
import { JobGroup, JobStatus } from 'src/subdomains/supporting/job/enums';
import { JOB_GROUP_DEFAULTS } from 'src/subdomains/supporting/job/job-group.config';
import { JobDispatcherService } from 'src/subdomains/supporting/job/services/job-dispatcher.service';
import { JobService } from 'src/subdomains/supporting/job/services/job.service';
import { AccountMerge } from '../../account-merge/account-merge.entity';
import { AccountMergeService } from '../../account-merge/account-merge.service';
import { UserData } from '../../user-data/user-data.entity';
import { UserDataService } from '../../user-data/user-data.service';
import { UserRepository } from '../../user/user.repository';
import { AuthAlbyService } from '../auth-alby.service';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';

// AuthController pulls TfaService in purely as a DI token — no test here calls check/setup/verify.
// Importing it drags in the KYC entity chain, which is circular at import time and breaks when an
// isolated spec is the first to resolve it (step-log.entity.ts: `class StepLog extends KycLog`
// runs while KycLog is still undefined). Replacing the module keeps that chain out of this suite.
jest.mock('src/subdomains/generic/kyc/services/tfa.service', () => ({
  TfaLevel: { BASIC: 'Basic', STRICT: 'Strict' },
  TfaService: class TfaService {},
}));

describe('AuthController', () => {
  let controller: AuthController;

  let authService: AuthService;
  let albyService: AuthAlbyService;
  let mergeService: AccountMergeService;
  let userRepo: UserRepository;
  let userDataService: UserDataService;
  let tfaService: TfaService;
  let jobService: JobService;
  let jobDispatcher: JobDispatcherService;
  let ipLogService: IpLogService;

  beforeEach(async () => {
    authService = createMock<AuthService>();
    albyService = createMock<AuthAlbyService>();
    mergeService = createMock<AccountMergeService>();
    userRepo = createMock<UserRepository>();
    userDataService = createMock<UserDataService>();
    tfaService = createMock<TfaService>();
    jobService = createMock<JobService>();
    jobDispatcher = createMock<JobDispatcherService>();
    // AuthController's routes carry IpCountryGuard, which injects IpLogService — without it Nest
    // cannot resolve the guard and the whole module fails to compile.
    ipLogService = createMock<IpLogService>();

    const module: TestingModule = await Test.createTestingModule({
      // AuthController's routes carry RateLimitGuard, which needs the throttler options.
      imports: [TestSharedModule, ThrottlerModule.forRoot()],
      providers: [
        AuthController,
        { provide: AuthService, useValue: authService },
        { provide: AuthAlbyService, useValue: albyService },
        { provide: AccountMergeService, useValue: mergeService },
        { provide: UserRepository, useValue: userRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: TfaService, useValue: tfaService },
        { provide: JobService, useValue: jobService },
        { provide: JobDispatcherService, useValue: jobDispatcher },
        { provide: IpLogService, useValue: ipLogService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('mail/confirm', () => {
    const code = 'merge-code';
    const ip = '1.2.3.4';
    const traceparent = '00-trace-01';
    const jwt = {
      account: 1,
      address: '0xabc',
      ip: '1.2.3.4',
      tfaRequired: false,
    } as JwtPayload;

    function createRes(): Response {
      return { status: jest.fn() } as unknown as Response;
    }

    it('returns kycHash and accessToken when the job completes immediately', async () => {
      const master = Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' });
      const request = Object.assign(new AccountMerge(), { id: 10, master, code });
      const completedJob = Object.assign(new Job(), {
        uid: 'Jmerge1',
        group: JobGroup.ACCOUNT_MERGE,
        status: JobStatus.COMPLETE,
        created: new Date(),
        output: JSON.stringify({ masterUserDataId: 1, kycHash: 'hash-1' }),
      });
      const res = createRes();

      jest.spyOn(mergeService, 'validateForExecution').mockResolvedValue(request);
      jest.spyOn(mergeService, 'getMaster').mockReturnValue(master);
      // createMock returns a truthy proxy for un-mocked methods, so the lookup has to be
      // stubbed explicitly — otherwise the controller takes the 'job already exists' branch.
      jest.spyOn(jobService, 'findByIdempotencyKey').mockResolvedValue(undefined);
      jest.spyOn(jobService, 'enqueue').mockResolvedValue(completedJob);
      jest.spyOn(userRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(authService, 'generateAccountToken').mockReturnValue('token-1');

      const result = await controller.executeMerge(jwt, code, ip, traceparent, res);

      expect(result).toEqual({ kycHash: 'hash-1', accessToken: 'token-1' });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(jobDispatcher.kick).toHaveBeenCalledWith(JobGroup.ACCOUNT_MERGE);
    });

    it('returns a JobDto with ACCEPTED when the job is still pending after the poll window', async () => {
      const master = Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' });
      const request = Object.assign(new AccountMerge(), { id: 11, master, code });
      const pendingJob = Object.assign(new Job(), {
        uid: 'Jmerge-pending',
        group: JobGroup.ACCOUNT_MERGE,
        status: JobStatus.PENDING,
        created: new Date(),
      });
      const res = createRes();

      jest.spyOn(mergeService, 'validateForExecution').mockResolvedValue(request);
      jest.spyOn(mergeService, 'getMaster').mockReturnValue(master);
      // createMock returns a truthy proxy for un-mocked methods, so the lookup has to be
      // stubbed explicitly — otherwise the controller takes the 'job already exists' branch.
      jest.spyOn(jobService, 'findByIdempotencyKey').mockResolvedValue(undefined);
      jest.spyOn(jobService, 'enqueue').mockResolvedValue(pendingJob);
      jest.spyOn(jobService, 'getByUid').mockResolvedValue(pendingJob);
      jest.spyOn(jobService, 'getConfig').mockResolvedValue(JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE]);

      const result = await controller.executeMerge(jwt, code, ip, traceparent, res);

      expect(result).toEqual(expect.objectContaining({ uid: 'Jmerge-pending' }));
      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    }, 15000);

    it('propagates ConflictException from validateForExecution and does not enqueue', async () => {
      const res = createRes();
      jest
        .spyOn(mergeService, 'validateForExecution')
        .mockRejectedValue(new ConflictException('Merge request is already completed'));

      await expect(controller.executeMerge(jwt, code, ip, traceparent, res)).rejects.toThrow(ConflictException);
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it('returns kycHash and accessToken on a second call when a COMPLETE job already exists', async () => {
      const master = Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' });
      const request = Object.assign(new AccountMerge(), { id: 12, master, code, isCompleted: true });
      const completedJob = Object.assign(new Job(), {
        uid: 'Jmerge-existing',
        group: JobGroup.ACCOUNT_MERGE,
        status: JobStatus.COMPLETE,
        created: new Date(),
        finishedAt: new Date(),
        output: JSON.stringify({ masterUserDataId: 1, kycHash: 'hash-1' }),
      });
      const res = createRes();

      jest.spyOn(mergeService, 'validateForExecution').mockResolvedValue(request);
      jest.spyOn(mergeService, 'getMaster').mockReturnValue(master);
      jest.spyOn(jobService, 'findByIdempotencyKey').mockResolvedValue(completedJob);
      jest.spyOn(userRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(authService, 'generateAccountToken').mockReturnValue('token-2');

      const result = await controller.executeMerge(jwt, code, ip, traceparent, res);

      expect(result).toEqual({ kycHash: 'hash-1', accessToken: 'token-2' });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(jobService.enqueue).not.toHaveBeenCalled();
      expect(jobDispatcher.kick).not.toHaveBeenCalled();
    });

    it('returns kycHash and accessToken when a COMPLETE job finished within the result window', async () => {
      const master = Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' });
      const request = Object.assign(new AccountMerge(), { id: 20, master, code, isCompleted: true });
      const completedJob = Object.assign(new Job(), {
        uid: 'Jmerge-within-window',
        group: JobGroup.ACCOUNT_MERGE,
        status: JobStatus.COMPLETE,
        created: new Date(),
        finishedAt: new Date(Date.now() - 2 * 60 * 1000),
        output: JSON.stringify({ masterUserDataId: 1, kycHash: 'hash-1' }),
      });
      const res = createRes();

      jest.spyOn(mergeService, 'validateForExecution').mockResolvedValue(request);
      jest.spyOn(mergeService, 'getMaster').mockReturnValue(master);
      jest.spyOn(jobService, 'findByIdempotencyKey').mockResolvedValue(completedJob);
      jest.spyOn(userRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(authService, 'generateAccountToken').mockReturnValue('token-within');

      const result = await controller.executeMerge(jwt, code, ip, traceparent, res);

      expect(result).toEqual({ kycHash: 'hash-1', accessToken: 'token-within' });
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it('throws ConflictException when a COMPLETE job finished outside the result window', async () => {
      const master = Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' });
      const request = Object.assign(new AccountMerge(), { id: 21, master, code, isCompleted: true });
      const completedJob = Object.assign(new Job(), {
        uid: 'Jmerge-outside-window',
        group: JobGroup.ACCOUNT_MERGE,
        status: JobStatus.COMPLETE,
        created: new Date(),
        finishedAt: new Date(Date.now() - 20 * 60 * 1000),
        output: JSON.stringify({ masterUserDataId: 1, kycHash: 'hash-1' }),
      });
      const res = createRes();

      jest.spyOn(mergeService, 'validateForExecution').mockResolvedValue(request);
      jest.spyOn(mergeService, 'getMaster').mockReturnValue(master);
      jest.spyOn(jobService, 'findByIdempotencyKey').mockResolvedValue(completedJob);

      await expect(controller.executeMerge(jwt, code, ip, traceparent, res)).rejects.toThrow(
        new ConflictException('Merge request is already completed'),
      );
      expect(jobService.enqueue).not.toHaveBeenCalled();
      expect(authService.generateAccountToken).not.toHaveBeenCalled();
      expect(authService.generateUserToken).not.toHaveBeenCalled();
    });

    it('throws ConflictException when merge is completed and no job exists', async () => {
      const master = Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' });
      const request = Object.assign(new AccountMerge(), { id: 13, master, code, isCompleted: true });
      const res = createRes();

      jest.spyOn(mergeService, 'validateForExecution').mockResolvedValue(request);
      jest.spyOn(mergeService, 'getMaster').mockReturnValue(master);
      jest.spyOn(jobService, 'findByIdempotencyKey').mockResolvedValue(undefined);

      await expect(controller.executeMerge(jwt, code, ip, traceparent, res)).rejects.toThrow(
        new ConflictException('Merge request is already completed'),
      );
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it('returns ACCEPTED JobDto when an existing job is FAILED', async () => {
      const master = Object.assign(new UserData(), { id: 1, kycHash: 'hash-1' });
      const request = Object.assign(new AccountMerge(), { id: 14, master, code, isCompleted: false });
      const failedJob = Object.assign(new Job(), {
        uid: 'Jmerge-failed',
        group: JobGroup.ACCOUNT_MERGE,
        status: JobStatus.FAILED,
        created: new Date(),
        error: 'internal connection refused',
      });
      const res = createRes();

      jest.spyOn(mergeService, 'validateForExecution').mockResolvedValue(request);
      jest.spyOn(mergeService, 'getMaster').mockReturnValue(master);
      jest.spyOn(jobService, 'findByIdempotencyKey').mockResolvedValue(failedJob);
      jest.spyOn(jobService, 'getConfig').mockResolvedValue(JOB_GROUP_DEFAULTS[JobGroup.ACCOUNT_MERGE]);

      const result = await controller.executeMerge(jwt, code, ip, traceparent, res);

      expect(result).toEqual(expect.objectContaining({ status: JobStatus.FAILED, uid: 'Jmerge-failed' }));
      expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });
  });
});
