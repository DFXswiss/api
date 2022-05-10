import { BadRequestException, Injectable } from '@nestjs/common';
import { KycDocument } from 'src/user/services/spider/dto/spider.dto';
import { KycCompleted } from '../user-data/user-data.entity';
import { UserDataService } from '../user-data/user-data.service';
import { LimitRequestDto } from './dto/limit-request.dto';
import { LimitRequestRepository } from './limit-request.repository';
import { SpiderService } from 'src/user/services/spider/spider.service';

@Injectable()
export class LimitRequestService {
  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly userDataService: UserDataService,
    private readonly spiderService: SpiderService,
  ) {}

  async increaseLimit(kycHash: string, dto: LimitRequestDto): Promise<void> {
    // get user data
    const user = await this.userDataService.getUserDataByKycHash(kycHash);
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

  private fromBase64(file: string): { contentType: string; buffer: Buffer } {
    const matches = file.match(/^data:(.+);base64,(.*)$/);
    return { contentType: matches[1], buffer: Buffer.from(matches[2], 'base64') };
  }
}
