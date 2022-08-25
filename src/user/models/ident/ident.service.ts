import { Injectable } from '@nestjs/common';
import { IdentInProgress } from 'src/user/models/user-data/user-data.entity';
import { UserDataRepository } from '../user-data/user-data.repository';
import { IdentFailed, IdentPending, IdentResultDto, IdentSucceeded } from './dto/ident-result.dto';
import { KycProcessService } from '../kyc/kyc-process.service';
import { Like } from 'typeorm';

@Injectable()
export class IdentService {
  constructor(private readonly userDataRepo: UserDataRepository, private readonly kycProcess: KycProcessService) {}

  // --- WEBHOOK UPDATES --- //
  async identUpdate(result: IdentResultDto): Promise<void> {
    let user = await this.userDataRepo.findOne({
      where: [
        {
          spiderData: { identIdentificationIds: Like(`%${result?.identificationprocess?.transactionnumber}%`) },
        },
        {
          spiderData: { identIdentificationIds: Like(`%${result?.identificationprocess?.id}%`) },
        },
      ],
      relations: ['spiderData'],
    });

    if (!user) {
      console.error(`Received unmatched webhook call:`, result);
      return;
    }

    if (!IdentInProgress(user.kycStatus)) {
      console.error(`Received webhook call for user ${user.id} in invalid KYC status ${user.kycStatus}:`, result);
      return;
    }

    console.log(
      `Received webhook call for user ${user.id} (${result.identificationprocess.id}): ${result.identificationprocess.result}`,
    );

    if (IdentSucceeded(result)) {
      user = await this.kycProcess.identCompleted(user, result);
    } else if (IdentPending(result)) {
      user = await this.kycProcess.identInReview(user, result);
    } else if (IdentFailed(result)) {
      user = await this.kycProcess.identFailed(user, result);
    } else {
      console.error(`Unknown ident result ${result.identificationprocess.result}`);
    }

    await this.userDataRepo.save(user);
  }
}
