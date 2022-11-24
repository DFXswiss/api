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
import { KycWebhookService } from '../kyc/kyc-webhook.service';

@Injectable()
export class LimitRequestService {
  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly userDataService: UserDataService,
    private readonly spiderService: SpiderService,
    private readonly kycWebhookService: KycWebhookService,
  ) {}

  async increaseLimit(dto: LimitRequestDto, kycHash: string, userId?: number): Promise<void> {
    // get user data
    const user = userId
      ? await this.userDataService.getUserDataByUser(userId)
      : await this.userDataService.getUserDataByKycHash(kycHash);
    if (!KycCompleted(user?.kycStatus)) throw new BadRequestException('KYC not yet completed');

    // create entity
    const entity = this.limitRequestRepo.create(dto);
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
    await this.limitRequestRepo.save(entity);
  }

  async updateLimitRequest(id: number, dto: UpdateLimitRequestDto): Promise<LimitRequest> {
    const entity = await this.limitRequestRepo.findOne(id, { relations: ['userData'] });
    if (!entity) throw new NotFoundException('LimitRequest not found');

    const update = this.limitRequestRepo.create(dto);

    if (LimitRequestAccepted(dto.decision) && dto.decision !== entity.decision)
      await this.kycWebhookService.kycChanged(entity.userData);

    Util.removeNullFields(entity);

    return await this.limitRequestRepo.save({ ...update, ...entity });
  }

  private fromBase64(file: string): { contentType: string; buffer: Buffer } {
    const matches = file.match(/^data:(.+);base64,(.*)$/);
    return { contentType: matches[1], buffer: Buffer.from(matches[2], 'base64') };
  }
}
