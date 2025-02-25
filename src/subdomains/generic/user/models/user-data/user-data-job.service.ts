import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycStepStatus } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { IsNull, Like } from 'typeorm';
import { AccountType } from './account-type.enum';
import { KycLevel, SignatoryPower } from './user-data.entity';
import { UserDataRepository } from './user-data.repository';

@Injectable()
export class UserDataJobService {
  constructor(private readonly userDataRepo: UserDataRepository) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.USER_DATA, timeout: 1800 })
  async fillUserData() {
    await this.bankTxVerification();
    await this.setAccountOpener();
  }

  private async bankTxVerification(): Promise<void> {
    const entities = await this.userDataRepo.find({
      where: {
        bankTransactionVerification: CheckStatus.GSHEET,
        kycFiles: { type: FileType.USER_NOTES, name: Like('%bankTransactionVerify%') },
      },
      relations: { kycFiles: true },
    });

    for (const entity of entities) {
      await this.userDataRepo.update(entity.id, { bankTransactionVerification: CheckStatus.PASS });
    }
  }

  private async setAccountOpener(): Promise<void> {
    const entities = await this.userDataRepo.find({
      where: {
        kycLevel: KycLevel.LEVEL_51,
        accountType: AccountType.ORGANIZATION,
        accountOpenerAuthorization: IsNull(),
        kycSteps: { name: KycStepName.SIGNATORY_POWER, status: KycStepStatus.COMPLETED },
      },
      relations: { kycSteps: true },
    });

    for (const entity of entities) {
      const signatoryResult = entity.kycSteps
        .find((k) => k.name === KycStepName.SIGNATORY_POWER && k.status === KycStepStatus.COMPLETED)
        .getResult<SignatoryPower>();

      await this.userDataRepo.update(...entity.setAccountOpenerAuthorization(signatoryResult));
    }
  }
}
