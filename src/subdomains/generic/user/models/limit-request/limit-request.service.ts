import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KycDocument } from 'src/subdomains/generic/user/services/spider/dto/spider.dto';
import { KycCompleted } from '../user-data/user-data.entity';
import { UserDataService } from '../user-data/user-data.service';
import { LimitRequestDto } from './dto/limit-request.dto';
import { LimitRequestRepository } from './limit-request.repository';
import { SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { UpdateLimitRequestDto } from './dto/update-limit-request.dto';
import { LimitRequest, LimitRequestAccepted } from './limit-request.entity';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { WebhookService } from '../../services/webhook/webhook.service';

@Injectable()
export class LimitRequestService {
  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly userDataService: UserDataService,
    private readonly spiderService: SpiderService,
    private readonly webhookService: WebhookService,
    private readonly notificationService: NotificationService,
  ) {}

  async increaseLimit(dto: LimitRequestDto, kycHash: string, userId?: number): Promise<void> {
    // get user data
    const user = userId
      ? await this.userDataService.getUserDataByUser(userId)
      : await this.userDataService.getUserDataByKycHash(kycHash);
    if (!KycCompleted(user?.kycStatus)) throw new BadRequestException('KYC not yet completed');

    // create entity
    let entity = this.limitRequestRepo.create(dto);
    entity.userData = user;

    // upload document proof
    if (dto.documentProof) {
      const { contentType, buffer } = this.fromBase64(dto.documentProof);
      const version = Date.now().toString();
      await this.spiderService.uploadDocument(
        user.id,
        false,
        KycDocument.USER_ADDED_DOCUMENT,
        dto.documentProofName,
        contentType,
        buffer,
        version,
      );

      entity.documentProofUrl = this.spiderService.getDocumentUrl(
        user.kycCustomerId,
        KycDocument.USER_ADDED_DOCUMENT,
        version,
      );
    }

    // save
    entity = await this.limitRequestRepo.save(entity);

    await this.notificationService
      .sendMail({
        type: MailType.INTERNAL,
        input: {
          to: 'liq@dfx.swiss',
          subject: 'LimitRequest',
          salutation: 'New LimitRequest',
          body: `<p>Limit: ${entity.limit} EUR</p>Investment date: ${entity.investmentDate}<p>Fund origin: ${entity.fundOrigin}</p><p>UserData id: ${entity.userData.id}</p>`,
        },
      })
      .catch((error) => console.error(`Failed to send limitRequest ${entity.id} created mail:`, error));
  }

  async updateLimitRequest(id: number, dto: UpdateLimitRequestDto): Promise<LimitRequest> {
    const entity = await this.limitRequestRepo.findOne(id, { relations: ['userData'] });
    if (!entity) throw new NotFoundException('LimitRequest not found');

    const update = this.limitRequestRepo.create(dto);

    if (LimitRequestAccepted(dto.decision) && dto.decision !== entity.decision)
      await this.webhookService.kycChanged(entity.userData);

    Util.removeNullFields(entity);

    return this.limitRequestRepo.save({ ...update, ...entity });
  }

  private fromBase64(file: string): { contentType: string; buffer: Buffer } {
    const matches = file.match(/^data:(.+);base64,(.*)$/);
    return { contentType: matches[1], buffer: Buffer.from(matches[2], 'base64') };
  }
}
