import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { FileSubType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycFileService } from 'src/subdomains/generic/kyc/services/kyc-file.service';
import { IsNull, MoreThanOrEqual, Not } from 'typeorm';
import { KycLevel } from '../user-data/user-data.enum';
import { TravelRulePdfService } from './travel-rule-pdf.service';
import { UserRepository } from './user.repository';

@Injectable()
export class TravelRuleJobService {
  private readonly logger = new DfxLogger(TravelRuleJobService);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly travelRulePdfService: TravelRulePdfService,
    private readonly kycDocumentService: KycDocumentService,
    private readonly kycFileService: KycFileService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.TRAVEL_RULE_PDF, timeout: 1800 })
  async generateTravelRulePdfs(): Promise<void> {
    const candidates = await this.userRepo.find({
      where: {
        signature: Not(IsNull()),
        travelRulePdfDate: IsNull(),
        userData: { kycLevel: MoreThanOrEqual(KycLevel.LEVEL_40) },
        custodyProvider: IsNull(),
      },
      relations: { userData: true },
      order: { id: 'ASC' },
      take: 100,
    });

    for (const user of candidates) {
      const now = new Date();

      // Claim-first CAS: LockClass is only process-wide, so atomically claim the candidate via an
      // `UPDATE ... WHERE travelRulePdfDate IS NULL` before doing any non-transactional upload work.
      // Only an affected row count of 1 means this replica won the claim and may proceed.
      const claim = await this.userRepo.update(
        { id: user.id, travelRulePdfDate: IsNull() },
        { travelRulePdfDate: now },
      );
      if (!claim.affected) continue;

      const originalName = this.buildFileName(user.id, now);

      try {
        const pdfBase64 = await this.travelRulePdfService.generateAddressSignaturePdf(user.address, user.signature);

        const { file } = await this.kycDocumentService.uploadUserFile(
          user.userData,
          FileType.USER_NOTES,
          originalName,
          Buffer.from(pdfBase64, 'base64'),
          ContentType.PDF,
          true,
          undefined,
          FileSubType.ADDRESS_SIGNATURE,
          { document: 'TravelRule', creationTime: now.toISOString(), fileName: originalName },
        );

        // de-facto audit trail (replaces the sheet `archiv` tab)
        this.logger.info(`TravelRule PDF created for user ${user.id}: ${originalName} (file ${file.id})`);
      } catch (e) {
        // Release the claim so the candidate is retried, and flag any orphan kyc_file row (created
        // before the blob upload failed) as invalid so reporting does not see a row without blob.
        await this.userRepo.update({ id: user.id }, { travelRulePdfDate: null }).catch(() => undefined);
        await this.invalidateOrphanFile(user.userData.id, originalName);
        this.logger.error(`TravelRule PDF failed for user ${user.id}`, e);
      }
    }
  }

  // *** HELPER METHODS *** //

  // `${yyyymmdd}-AddressSignature-0-${userId}-${hhmmss}.pdf`; the leading `yyyymmdd` carries no
  // hyphen so the Travel-Rule download filter (config id 15) can sort on `split('-')[0]`.
  private buildFileName(userId: number, now: Date): string {
    const yyyymmdd = Util.isoDate(now).replace(/-/g, '');
    const hhmmss = Util.isoTime(now).replace(/-/g, '');
    return `${yyyymmdd}-AddressSignature-0-${userId}-${hhmmss}.pdf`;
  }

  private async invalidateOrphanFile(userDataId: number, name: string): Promise<void> {
    const files = await this.kycFileService.getUserDataKycFiles(userDataId);
    const orphan = files.find((f) => f.name === name);
    if (orphan) await this.kycFileService.invalidateKycFile(orphan.id).catch(() => undefined);
  }
}
