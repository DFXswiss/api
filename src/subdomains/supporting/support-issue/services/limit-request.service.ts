import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UserData } from '../../../generic/user/models/user-data/user-data.entity';
import { WebhookService } from '../../../generic/user/services/webhook/webhook.service';
import { LimitRequestDto } from '../dto/limit-request.dto';
import { UpdateLimitRequestDto } from '../dto/update-limit-request.dto';
import { LimitRequest, LimitRequestAccepted, LimitRequestFinal } from '../entities/limit-request.entity';
import { SupportIssue } from '../entities/support-issue.entity';
import { SupportIssueInternalState, SupportIssueType } from '../enums/support-issue.enum';
import { SupportLogType } from '../enums/support-log.enum';
import { LimitRequestRepository } from '../repositories/limit-request.repository';
import { SupportLogService } from './support-log.service';

@Injectable()
export class LimitRequestService {
  private readonly logger = new DfxLogger(LimitRequestService);

  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly webhookService: WebhookService,
    private readonly notificationService: NotificationService,
    private readonly supportLogService: SupportLogService,
  ) {}

  async increaseLimitInternal(dto: LimitRequestDto, userData: UserData): Promise<LimitRequest> {
    if (userData.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException('Missing KYC');

    // create entity
    let entity = this.limitRequestRepo.create(dto);

    // save
    entity = await this.limitRequestRepo.save(entity);

    await this.notificationService
      .sendMail({
        type: MailType.INTERNAL,
        context: MailContext.LIMIT_REQUEST,
        input: {
          to: 'limitRequest@dfx.swiss',
          title: 'LimitRequest',
          salutation: { key: 'New LimitRequest' },
          prefix: [
            { key: `Limit: ${entity.limit} EUR` },
            { key: `Investment date: ${entity.investmentDate}` },
            { key: `Fund origin: ${entity.fundOrigin}` },
            { key: `Fund origin text: ${entity.fundOriginText}` },
            { key: `UserData id: ${userData.id}` },
          ],
        },
      })
      .catch((error) => this.logger.error(`Failed to send limitRequest ${entity.id} created mail:`, error));

    return entity;
  }

  async updateLimitRequest(id: number, dto: UpdateLimitRequestDto): Promise<LimitRequest> {
    const { grantedDepositLimit, ...update } = dto;
    let finalEntity!: LimitRequest;

    // grantedDepositLimit never reaches the limit_request row or the support log — it belongs to
    // user_data.depositLimit only. The finality check and both writes (depositLimit and the decision
    // itself) now share one transaction with a pessimistic row lock on the limit_request row, so a
    // granting decision genuinely cannot race a concurrent update on the same request. The separate
    // storage-side report race (SupportService.generateAndSaveLimitRequestPdf's collision check) is
    // unrelated and stays tracked in issue #4619.
    const saved = await this.limitRequestRepo.manager.transaction(async (manager) => {
      const entity = await manager
        .createQueryBuilder(LimitRequest, 'lr')
        .innerJoinAndSelect('lr.supportIssue', 'issue')
        .innerJoinAndSelect('issue.userData', 'userData')
        .where('lr.id = :id', { id })
        .setLock('pessimistic_write', undefined, ['lr'])
        .getOne();

      if (!entity) throw new NotFoundException('LimitRequest not found');
      if (LimitRequestFinal(entity.decision)) throw new BadRequestException('Limit request already final');

      if (grantedDepositLimit != null && !LimitRequestAccepted(update.decision))
        throw new BadRequestException('grantedDepositLimit is only allowed on a granting decision');

      if (grantedDepositLimit != null && LimitRequestAccepted(update.decision))
        await manager.update(UserData, entity.userData.id, { depositLimit: grantedDepositLimit });

      if (update.decision !== entity.decision && LimitRequestFinal(update.decision)) {
        await manager.update(SupportIssue, entity.supportIssue.id, { state: SupportIssueInternalState.COMPLETED });
      }

      finalEntity = entity;

      return manager.save(LimitRequest, { ...entity, ...update });
    });

    // External effects only after a successful commit — a rollback (NotFound / already-final /
    // grantedDepositLimit guard above) must never leave a webhook fired or a support log written for a
    // change that never took effect.
    if (
      update.decision !== finalEntity.decision &&
      LimitRequestFinal(update.decision) &&
      LimitRequestAccepted(update.decision)
    )
      await this.webhookService.kycChanged(finalEntity.userData);

    await this.supportLogService.createSupportLog(finalEntity.supportIssue.userData, {
      type: SupportLogType.LIMIT_REQUEST,
      limitRequest: finalEntity,
      ...update,
    });

    return saved;
  }

  async getUserLimitRequests(userDataId: number): Promise<LimitRequest[]> {
    return this.limitRequestRepo.findBy({
      supportIssue: { userData: { id: userDataId }, type: SupportIssueType.LIMIT_REQUEST },
    });
  }
}
