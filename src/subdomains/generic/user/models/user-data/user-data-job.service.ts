import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { In, IsNull, Like, MoreThan, Not } from 'typeorm';
import { AccountType } from './account-type.enum';
import { KycLevel, SignatoryPower, UserDataStatus } from './user-data.enum';
import { UserDataRepository } from './user-data.repository';

@Injectable()
export class UserDataJobService {
  constructor(private readonly userDataRepo: UserDataRepository, private readonly kycService: KycService) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.USER_DATA, timeout: 1800 })
  async fillUserData() {
    await this.bankTxVerification();
    await this.setAccountOpener();
  }

  private async walletSync(): Promise<void> {
    const entities = await this.userDataRepo.find({
      where: {
        wallet: { id: IsNull() },
        status: Not(In([UserDataStatus.KYC_ONLY, UserDataStatus.MERGED])),
        users: { id: Not(IsNull()) },
      },
      take: 5000,
      relations: { users: { wallet: true } },
    });

    for (const entity of entities) {
      await this.userDataRepo.update(entity.id, { wallet: entity.users[0].wallet });
    }
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
        kycLevel: MoreThan(KycLevel.LEVEL_30),
        accountType: AccountType.ORGANIZATION,
        accountOpenerAuthorization: IsNull(),
        kycSteps: { name: KycStepName.SIGNATORY_POWER, status: ReviewStatus.COMPLETED },
      },
      relations: { kycSteps: true },
    });

    for (const entity of entities) {
      const signatoryResult = entity.kycSteps
        .find((k) => k.name === KycStepName.SIGNATORY_POWER && k.status === ReviewStatus.COMPLETED)
        .getResult<{ signatoryPower: SignatoryPower }>();

      await this.userDataRepo.update(...entity.setAccountOpenerAuthorization(signatoryResult.signatoryPower));
    }
  }
}
