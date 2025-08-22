import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UserData } from '../../../generic/user/models/user-data/user-data.entity';
import { WebhookService } from '../../../generic/user/services/webhook/webhook.service';
import { LimitRequestDto } from '../dto/limit-request.dto';
import { UpdateLimitRequestDto } from '../dto/update-limit-request.dto';
import { LimitRequest, LimitRequestAccepted, LimitRequestFinal } from '../entities/limit-request.entity';
import { SupportIssueState, SupportIssueType } from '../enums/support-issue.enum';
import { SupportLogType } from '../enums/support-log.enum';
import { LimitRequestRepository } from '../repositories/limit-request.repository';
import { SupportIssueRepository } from '../repositories/support-issue.repository';
import { SupportLogService } from './support-log.service';

@Injectable()
export class LimitRequestService {
  private readonly logger = new DfxLogger(LimitRequestService);

  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly webhookService: WebhookService,
    private readonly notificationService: NotificationService,
    private readonly supportIssueRepo: SupportIssueRepository,
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
    const entity = await this.limitRequestRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('LimitRequest not found');
    if (LimitRequestFinal(entity.decision)) throw new BadRequestException('Limit request already final');

    const update = this.limitRequestRepo.create(dto);

    if (dto.decision !== entity.decision && LimitRequestFinal(dto.decision)) {
      await this.supportIssueRepo.update(entity.supportIssue.id, {
        state: SupportIssueState.COMPLETED,
      });
      if (LimitRequestAccepted(dto.decision)) await this.webhookService.kycChanged(entity.userData);
    }

    await this.supportLogService.createSupportLog(entity.supportIssue.userData, {
      type: SupportLogType.LIMIT_REQUEST,
      limitRequest: entity,
      ...update,
    });

    return this.limitRequestRepo.save({ ...entity, ...Util.removeNullFields(update) });
  }

  async getUserLimitRequests(userDataId: number): Promise<LimitRequest[]> {
    return this.limitRequestRepo.findBy({
      supportIssue: { userData: { id: userDataId }, type: SupportIssueType.LIMIT_REQUEST },
    });
  }
}
