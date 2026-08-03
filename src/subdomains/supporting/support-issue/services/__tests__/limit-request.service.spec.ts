import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EntityManager } from 'typeorm';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UpdateLimitRequestDto } from 'src/subdomains/supporting/support-issue/dto/update-limit-request.dto';
import {
  LimitRequest,
  LimitRequestDecision,
} from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { LimitRequestRepository } from 'src/subdomains/supporting/support-issue/repositories/limit-request.repository';
import { LimitRequestService } from 'src/subdomains/supporting/support-issue/services/limit-request.service';
import { SupportLogService } from 'src/subdomains/supporting/support-issue/services/support-log.service';

describe('LimitRequestService.updateLimitRequest', () => {
  let service: LimitRequestService;
  let limitRequestRepo: DeepMocked<LimitRequestRepository>;
  let webhookService: DeepMocked<WebhookService>;
  let notificationService: DeepMocked<NotificationService>;
  let supportLogService: DeepMocked<SupportLogService>;
  let queryBuilder: {
    innerJoinAndSelect: jest.Mock;
    where: jest.Mock;
    setLock: jest.Mock;
    getOne: jest.Mock;
  };
  let mockManager: {
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
  };

  const USER_DATA_ID = 42;
  const SUPPORT_ISSUE_ID = 7;

  // `decision` undefined mirrors a freshly created, never-decided LimitRequest — not itself final, so
  // it clears the "already final" guard and isolates the behavior under test.
  function makeLimitRequest(decision?: LimitRequestDecision): LimitRequest {
    const supportIssue = Object.assign(new SupportIssue(), {
      id: SUPPORT_ISSUE_ID,
      userData: { id: USER_DATA_ID } as UserData,
    });
    return Object.assign(new LimitRequest(), { id: 1, decision, supportIssue });
  }

  beforeEach(() => {
    limitRequestRepo = createMock<LimitRequestRepository>();
    webhookService = createMock<WebhookService>();
    notificationService = createMock<NotificationService>();
    supportLogService = createMock<SupportLogService>();

    queryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    mockManager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      update: jest.fn(),
      save: jest.fn(async (_target, data) => data),
    };
    // The service reaches the transactional connection through `limitRequestRepo.manager` — override
    // just that property with a manager whose `transaction` runs the callback against our own mock, the
    // same technique already used in kyc-log.service.spec.ts for a repo-driven transaction.
    (limitRequestRepo as unknown as { manager: EntityManager }).manager = {
      transaction: jest.fn(async (run: (manager: EntityManager) => Promise<unknown>) =>
        run(mockManager as unknown as EntityManager),
      ),
    } as unknown as EntityManager;

    service = new LimitRequestService(limitRequestRepo, webhookService, notificationService, supportLogService);
  });

  it('rejects grantedDepositLimit on a non-granting decision, before writing anything', async () => {
    const entity = makeLimitRequest(undefined);
    queryBuilder.getOne.mockResolvedValue(entity);
    const dto = { decision: LimitRequestDecision.REJECTED, grantedDepositLimit: 5000 } as UpdateLimitRequestDto;

    await expect(service.updateLimitRequest(1, dto)).rejects.toThrow(BadRequestException);
    expect(mockManager.update).not.toHaveBeenCalled();
    expect(mockManager.save).not.toHaveBeenCalled();
  });

  it('writes grantedDepositLimit to user_data on a granting decision, without leaking it onto the row or the log', async () => {
    const entity = makeLimitRequest(undefined);
    queryBuilder.getOne.mockResolvedValue(entity);
    const dto = {
      decision: LimitRequestDecision.ACCEPTED,
      grantedDepositLimit: 5000,
    } as UpdateLimitRequestDto;

    await service.updateLimitRequest(1, dto);

    expect(mockManager.update).toHaveBeenCalledWith(UserData, USER_DATA_ID, { depositLimit: 5000 });

    const savedArg = mockManager.save.mock.calls[0][1] as Record<string, unknown>;
    expect(savedArg).not.toHaveProperty('grantedDepositLimit');

    const logArg = supportLogService.createSupportLog.mock.calls[0][1];
    expect(logArg).not.toHaveProperty('grantedDepositLimit');
  });

  // The race this feature closes: a request that has already been decided (by a concurrent call, or by
  // the time this one is processed) must never write depositLimit — the finality check and the write are
  // in the same transaction, under a pessimistic row lock, so there is no window between "checked" and
  // "written" for a second decision to land in.
  it('rejects an already-final request without writing to user_data', async () => {
    const entity = makeLimitRequest(LimitRequestDecision.ACCEPTED);
    queryBuilder.getOne.mockResolvedValue(entity);
    const dto = {
      decision: LimitRequestDecision.ACCEPTED,
      grantedDepositLimit: 5000,
    } as UpdateLimitRequestDto;

    await expect(service.updateLimitRequest(1, dto)).rejects.toThrow(BadRequestException);
    expect(mockManager.update).not.toHaveBeenCalled();
    expect(mockManager.save).not.toHaveBeenCalled();
    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write', undefined, ['lr']);
  });

  it('runs neither the webhook nor the support log when the transaction rejects an already-final request', async () => {
    const entity = makeLimitRequest(LimitRequestDecision.ACCEPTED);
    queryBuilder.getOne.mockResolvedValue(entity);
    const dto = {
      decision: LimitRequestDecision.ACCEPTED,
      grantedDepositLimit: 5000,
    } as UpdateLimitRequestDto;

    await expect(service.updateLimitRequest(1, dto)).rejects.toThrow(BadRequestException);
    expect(mockManager.update).not.toHaveBeenCalled();
    expect(webhookService.kycChanged).not.toHaveBeenCalled();
    expect(supportLogService.createSupportLog).not.toHaveBeenCalled();
  });

  it('leaves user_data untouched on a granting decision without grantedDepositLimit (unchanged behavior)', async () => {
    const entity = makeLimitRequest(undefined);
    queryBuilder.getOne.mockResolvedValue(entity);
    const dto = { decision: LimitRequestDecision.ACCEPTED } as UpdateLimitRequestDto;

    await service.updateLimitRequest(1, dto);

    expect(mockManager.update).not.toHaveBeenCalledWith(UserData, expect.anything(), expect.anything());
    expect(mockManager.save).toHaveBeenCalled();
  });

  it('throws NotFound when the request does not exist', async () => {
    queryBuilder.getOne.mockResolvedValue(null);

    await expect(
      service.updateLimitRequest(1, { decision: LimitRequestDecision.ACCEPTED } as UpdateLimitRequestDto),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an explicit null grantedDepositLimit on the DTO', async () => {
    const dto = plainToInstance(UpdateLimitRequestDto, {
      decision: LimitRequestDecision.ACCEPTED,
      clerk: 'JR',
      edited: new Date('2026-01-01T00:00:00.000Z'),
      acceptedLimit: 5000,
      grantedDepositLimit: null,
    });

    const errors = await validate(dto);

    expect(errors.find((e) => e.property === 'grantedDepositLimit')).toBeDefined();
  });

  it('runs the webhook and the support log only after the transaction has committed', async () => {
    queryBuilder.getOne.mockResolvedValue(makeLimitRequest(undefined));
    const dto = {
      decision: LimitRequestDecision.ACCEPTED,
      grantedDepositLimit: 5000,
    } as UpdateLimitRequestDto;

    const callOrder: string[] = [];
    mockManager.save.mockImplementation(async (_target, data) => {
      callOrder.push('transaction:save');
      return data;
    });
    webhookService.kycChanged.mockImplementation(async () => {
      callOrder.push('webhook');
    });
    supportLogService.createSupportLog.mockImplementation(async () => {
      callOrder.push('supportLog');
    });

    await service.updateLimitRequest(1, dto);

    expect(callOrder).toEqual(['transaction:save', 'webhook', 'supportLog']);
  });
});
