import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UpdateLimitRequestDto } from '../../dto/update-limit-request.dto';
import { LimitRequest, LimitRequestDecision } from '../../entities/limit-request.entity';
import { SupportIssue } from '../../entities/support-issue.entity';
import { LimitRequestRepository } from '../../repositories/limit-request.repository';
import { SupportIssueRepository } from '../../repositories/support-issue.repository';
import { LimitRequestService } from '../limit-request.service';
import { SupportLogService } from '../support-log.service';

describe('LimitRequestService.updateLimitRequest', () => {
  let service: LimitRequestService;
  let limitRequestRepo: DeepMocked<LimitRequestRepository>;
  let webhookService: DeepMocked<WebhookService>;
  let notificationService: DeepMocked<NotificationService>;
  let supportIssueRepo: DeepMocked<SupportIssueRepository>;
  let supportLogService: DeepMocked<SupportLogService>;
  let userDataRepo: DeepMocked<Repository<UserData>>;

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
    supportIssueRepo = createMock<SupportIssueRepository>();
    supportLogService = createMock<SupportLogService>();
    userDataRepo = createMock<Repository<UserData>>();

    limitRequestRepo.save.mockImplementation(async (entity) => entity as LimitRequest);

    service = new LimitRequestService(
      limitRequestRepo,
      webhookService,
      notificationService,
      supportIssueRepo,
      supportLogService,
      userDataRepo,
    );
  });

  it('rejects grantedDepositLimit on a non-granting decision, before writing anything', async () => {
    const entity = makeLimitRequest(undefined);
    limitRequestRepo.findOneBy.mockResolvedValue(entity);
    const dto = { decision: LimitRequestDecision.REJECTED, grantedDepositLimit: 5000 } as UpdateLimitRequestDto;

    await expect(service.updateLimitRequest(1, dto)).rejects.toThrow(BadRequestException);
    expect(userDataRepo.update).not.toHaveBeenCalled();
    expect(limitRequestRepo.save).not.toHaveBeenCalled();
  });

  it('writes grantedDepositLimit to user_data on a granting decision, without leaking it onto the row or the log', async () => {
    const entity = makeLimitRequest(undefined);
    limitRequestRepo.findOneBy.mockResolvedValue(entity);
    const dto = {
      decision: LimitRequestDecision.ACCEPTED,
      grantedDepositLimit: 5000,
    } as UpdateLimitRequestDto;

    await service.updateLimitRequest(1, dto);

    expect(userDataRepo.update).toHaveBeenCalledWith(USER_DATA_ID, { depositLimit: 5000 });

    const savedArg = limitRequestRepo.save.mock.calls[0][0] as Record<string, unknown>;
    expect(savedArg).not.toHaveProperty('grantedDepositLimit');

    const logArg = supportLogService.createSupportLog.mock.calls[0][1] as Record<string, unknown>;
    expect(logArg).not.toHaveProperty('grantedDepositLimit');
  });

  // The race this feature closes: a request that has already been decided (by a concurrent call, or by
  // the time this one is processed) must never write depositLimit — the finality check and the write are
  // now in the same call, so there is no window between "checked" and "written" for a second decision to
  // land in.
  it('rejects an already-final request without writing to user_data', async () => {
    const entity = makeLimitRequest(LimitRequestDecision.ACCEPTED);
    limitRequestRepo.findOneBy.mockResolvedValue(entity);
    const dto = {
      decision: LimitRequestDecision.ACCEPTED,
      grantedDepositLimit: 5000,
    } as UpdateLimitRequestDto;

    await expect(service.updateLimitRequest(1, dto)).rejects.toThrow(BadRequestException);
    expect(userDataRepo.update).not.toHaveBeenCalled();
    expect(limitRequestRepo.save).not.toHaveBeenCalled();
  });

  it('leaves user_data untouched on a granting decision without grantedDepositLimit (unchanged behavior)', async () => {
    const entity = makeLimitRequest(undefined);
    limitRequestRepo.findOneBy.mockResolvedValue(entity);
    const dto = { decision: LimitRequestDecision.ACCEPTED } as UpdateLimitRequestDto;

    await service.updateLimitRequest(1, dto);

    expect(userDataRepo.update).not.toHaveBeenCalled();
    expect(limitRequestRepo.save).toHaveBeenCalled();
  });

  it('throws NotFound when the request does not exist', async () => {
    limitRequestRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.updateLimitRequest(1, { decision: LimitRequestDecision.ACCEPTED } as UpdateLimitRequestDto),
    ).rejects.toThrow(NotFoundException);
  });
});
