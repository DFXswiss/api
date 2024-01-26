import { Injectable, NotFoundException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { KycContentType, KycFileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { DocumentStorageService } from 'src/subdomains/generic/kyc/services/integration/document-storage.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { WebhookService } from '../../user/services/webhook/webhook.service';
import { LimitRequestDto } from '../dto/input/limit-request.dto';
import { UpdateLimitRequestDto } from '../dto/input/update-limit-request.dto';
import { LimitRequest, LimitRequestAccepted } from '../entities/limit-request.entity';
import { LimitRequestRepository } from '../repositories/limit-request.repository';

@Injectable()
export class LimitRequestService {
  private readonly logger = new DfxLogger(LimitRequestService);

  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly userDataService: UserDataService,
    private readonly storageService: DocumentStorageService,
    private readonly webhookService: WebhookService,
    private readonly notificationService: NotificationService,
  ) {}

  async increaseLimit(dto: LimitRequestDto, kycHash: string, userId?: number): Promise<void> {
    // get user data
    const user = userId
      ? await this.userDataService.getUserDataByUser(userId)
      : await this.userDataService.getByKycHashOrThrow(kycHash);

    // create entity
    let entity = this.limitRequestRepo.create(dto);
    entity.userData = user;

    // upload document proof
    if (dto.documentProof) {
      const { contentType, buffer } = this.fromBase64(dto.documentProof);

      entity.documentProofUrl = await this.storageService.uploadFile(
        user.id,
        KycFileType.USER_NOTES,
        `${Util.isoDateTime(new Date())}_limit-request_user-upload_${dto.documentProofName}`,
        buffer,
        contentType as KycContentType,
      );
    }

    // save
    entity = await this.limitRequestRepo.save(entity);

    await this.notificationService
      .sendMail({
        type: MailType.INTERNAL,
        input: {
          to: 'liq@dfx.swiss',
          title: 'LimitRequest',
          salutation: { key: 'New LimitRequest' },
          prefix: [
            { key: `Limit: ${entity.limit} EUR` },
            { key: `Investment date: ${entity.investmentDate}` },
            { key: `Fund origin: ${entity.fundOrigin}` },
            { key: `UserData id: ${entity.userData.id}` },
          ],
        },
      })
      .catch((error) => this.logger.error(`Failed to send limitRequest ${entity.id} created mail:`, error));
  }

  async updateLimitRequest(id: number, dto: UpdateLimitRequestDto): Promise<LimitRequest> {
    const entity = await this.limitRequestRepo.findOne({ where: { id }, relations: ['userData'] });
    if (!entity) throw new NotFoundException('LimitRequest not found');

    const update = this.limitRequestRepo.create(dto);

    if (LimitRequestAccepted(dto.decision) && dto.decision !== entity.decision)
      await this.webhookService.kycChanged(entity.userData);

    Util.removeNullFields(entity);

    return this.limitRequestRepo.save({ ...update, ...entity });
  }

  private fromBase64(file: string): { contentType: string; buffer: Buffer } {
    const [contentType, content] = file.split(';base64,');
    return { contentType: contentType.replace('data:', ''), buffer: Buffer.from(content, 'base64') };
  }
}
