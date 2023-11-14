import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IdentInProgress } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Like } from 'typeorm';
import { KycProcessService } from '../kyc/kyc-process.service';
import { UserDataRepository } from '../user-data/user-data.repository';
import { IdentAborted, IdentFailed, IdentPending, IdentResultDto, IdentSucceeded } from './dto/ident-result.dto';

@Injectable()
export class IdentService {
  private readonly logger = new DfxLogger(IdentService);

  constructor(private readonly userDataRepo: UserDataRepository, private readonly kycProcess: KycProcessService) {}

  // --- WEBHOOK UPDATES --- //
  async identUpdate(result: IdentResultDto): Promise<void> {
    let user = await this.userDataRepo.findOne({
      where: [
        // TODO: remove check for transaction number
        {
          spiderData: { identIdentificationIds: Like(`%${result?.identificationprocess?.transactionnumber}%`) },
        },
        {
          spiderData: { identIdentificationIds: Like(`%${result?.identificationprocess?.id}%`) },
        },
      ],
      relations: ['spiderData', 'users', 'users.wallet'],
    });

    if (!user) {
      this.logger.error(`Received unmatched webhook call: ${JSON.stringify(result)}`);
      return;
    }

    if (!IdentInProgress(user.kycStatus)) {
      this.logger.error(
        `Received webhook call for user ${user.id} in invalid KYC status ${user.kycStatus}: ${JSON.stringify(result)}`,
      );
      return;
    }

    this.logger.info(
      `Received webhook call for user ${user.id} (${result.identificationprocess.id}): ${result.identificationprocess.result}`,
    );

    if (IdentSucceeded(result)) {
      user = await this.kycProcess.identCompleted(user, result);
    } else if (IdentPending(result)) {
      user = await this.kycProcess.identInReview(user, result);
    } else if (IdentAborted(result)) {
      this.logger.info(`Ident cancelled for user ${user.id}: ${result.identificationprocess.result}`);
    } else if (IdentFailed(result)) {
      user = await this.kycProcess.identFailed(user, result);
    } else {
      this.logger.error(`Unknown ident result for user ${user.id}: ${result.identificationprocess.result}`);
    }

    await this.userDataRepo.save(user);
  }
}
