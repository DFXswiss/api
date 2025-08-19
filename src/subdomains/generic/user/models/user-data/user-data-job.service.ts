import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { IsNull, Like, MoreThan, Not } from 'typeorm';
import { AccountType } from './account-type.enum';
import { KycLevel, KycType, SignatoryPower, UserDataStatus } from './user-data.entity';
import { UserDataRepository } from './user-data.repository';

@Injectable()
export class UserDataJobService {
  constructor(private readonly userDataRepo: UserDataRepository) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.USER_DATA, timeout: 1800 })
  async fillUserData() {
    await this.bankTxVerification();
    await this.setAccountOpener();
    await this.setKycLevel40();
    await this.fillHasBankTx();
  }

  private async fillHasBankTx(): Promise<void> {
    const entities = await this.userDataRepo.find({
      where: { hasBankTx: IsNull() },
      relations: { transactions: { buyCrypto: true } },
      take: 5000,
    });

    for (const entity of entities) {
      const hasBankTx = entity.transactions.some(
        (t) =>
          (t.buyCrypto?.isComplete || t.amlCheck === CheckStatus.PASS) &&
          t.sourceType === TransactionSourceType.BANK_TX,
      );
      await this.userDataRepo.update(entity.id, { hasBankTx });
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

  private async setKycLevel40(): Promise<void> {
    const entities = await this.userDataRepo.find({
      where: {
        kycLevel: KycLevel.LEVEL_30,
        kycType: KycType.DFX,
        status: Not(UserDataStatus.MERGED),
        kycSteps: { name: KycStepName.FINANCIAL_DATA, status: ReviewStatus.COMPLETED },
      },
      relations: { kycSteps: true },
    });

    for (const entity of entities) {
      await this.userDataRepo.update(entity.id, { kycLevel: KycLevel.LEVEL_40 });
    }
  }
}
