import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { ContentType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { KycLevel, UserData } from '../../../generic/user/models/user-data/user-data.entity';
import { UserDataService } from '../../../generic/user/models/user-data/user-data.service';
import { WebhookService } from '../../../generic/user/services/webhook/webhook.service';
import { LimitRequestDto, LimitRequestInternalDto } from '../dto/limit-request.dto';
import { UpdateLimitRequestDto } from '../dto/update-limit-request.dto';
import { LimitRequest, LimitRequestAccepted } from '../entities/limit-request.entity';
import { SupportIssueState } from '../entities/support-issue.entity';
import { LimitRequestRepository } from '../repositories/limit-request.repository';
import { SupportIssueRepository } from '../repositories/support-issue.repository';

@Injectable()
export class LimitRequestService {
  private readonly logger = new DfxLogger(LimitRequestService);

  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly userDataService: UserDataService,
    private readonly storageService: DocumentStorageService,
    private readonly webhookService: WebhookService,
    private readonly notificationService: NotificationService,
    private readonly supportIssueRepo: SupportIssueRepository,
  ) {}

  async increaseLimit(dto: LimitRequestDto, kycHash?: string, userDataId?: number): Promise<void> {
    // get user data
    const user = userDataId
      ? await this.userDataService.getUserData(userDataId)
      : await this.userDataService.getByKycHashOrThrow(kycHash);

    // upload document proof
    if (dto.documentProof) {
      const { contentType, buffer } = Util.fromBase64(dto.documentProof);

      const documentProofUrl = await this.storageService.uploadFile(
        user.id,
        FileType.USER_NOTES,
        `${Util.isoDateTime(new Date())}_limit-request_user-upload_${dto.documentProofName}`,
        buffer,
        contentType as ContentType,
      );

      await this.increaseLimitInternal({ ...dto, documentProofUrl }, user);
    } else {
      await this.increaseLimitInternal(dto, user);
    }
  }

  async increaseLimitInternal(dto: LimitRequestInternalDto, userData: UserData): Promise<LimitRequest> {
    if (userData.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException('Missing KYC');

    // create entity
    let entity = this.limitRequestRepo.create({ ...dto, userData });

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
            { key: `Document url: ${entity.documentProofUrl}` },
            { key: `UserData id: ${entity.userData.id}` },
          ],
        },
      })
      .catch((error) => this.logger.error(`Failed to send limitRequest ${entity.id} created mail:`, error));

    return entity;
  }

  async updateLimitRequest(id: number, dto: UpdateLimitRequestDto): Promise<LimitRequest> {
    const entity = await this.limitRequestRepo.findOne({
      where: { id },
      relations: { userData: true, supportIssue: true },
    });
    if (!entity) throw new NotFoundException('LimitRequest not found');

    const update = this.limitRequestRepo.create(dto);

    if (dto.decision !== entity.decision) {
      await this.supportIssueRepo.update(entity.supportIssue.id, {
        state: SupportIssueState.COMPLETED,
      });
      if (LimitRequestAccepted(dto.decision)) await this.webhookService.kycChanged(entity.userData);
    }

    Util.removeNullFields(entity);

    return this.limitRequestRepo.save({ ...update, ...entity });
  }

  async getUserLimitRequests(userDataId: number): Promise<LimitRequest[]> {
    return this.limitRequestRepo.find({ where: { userData: { id: userDataId } }, relations: { userData: true } });
  }
}
