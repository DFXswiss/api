import { Injectable } from '@nestjs/common';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';
import { KycService } from 'src/user/services/kyc/kyc.service';
import { UserDataService } from '../userData/userData.service';
import { LimitRequestDto } from './dto/limit-request.dto';
import { LimitRequest } from './limit-request.entity';
import { LimitRequestRepository } from './limit-request.repository';

@Injectable()
export class LimitRequestService {
  constructor(
    private readonly limitRequestRepo: LimitRequestRepository,
    private readonly userDataService: UserDataService,
    private readonly kycService: KycService,
  ) {}

  async increaseLimit(userId: number, dto: LimitRequestDto): Promise<LimitRequest> {
    // get user data
    const user = await this.userDataService.getUserDataForUser(userId);

    // create entity
    const entity = this.limitRequestRepo.create(dto);
    entity.userData = user;

    // upload document proof
    if (dto.documentProof) {
      const { contentType, buffer } = this.fromBase64(dto.documentProof);
      const version = new Date().getTime().toString();
      await this.kycService.uploadDocument(
        user.id,
        false,
        KycDocument.USER_ADDED_DOCUMENT,
        version,
        dto.documentProofName,
        contentType,
        buffer,
      );

      entity.documentProofUrl = `https://kyc.eurospider.com/toolbox/rest/customer-resource/customer/${user.kycCustomerId}/doctype/user-added-document/version/${version}/part/content`;
    }

    // save
    return await this.limitRequestRepo.save(entity);
  }

  private fromBase64(file: string): { contentType: string; buffer: Buffer } {
    const matches = file.match(/^data:(.+);base64,(.*)$/);
    return { contentType: matches[1], buffer: Buffer.from(matches[2], 'base64') };
  }
}
