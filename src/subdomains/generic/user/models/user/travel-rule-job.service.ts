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

      // Fail-closed signature validation BEFORE claiming: a candidate whose `signature` is not a
      // recognised cryptographic address-ownership proof must never get a PDF (historically 9
      // worthless masterKey-UUID pseudo-signatures were uploaded with status TRUE). On rejection we
      // skip without setting travelRulePdfDate, so the candidate stays visible for inspection.
      if (!this.isValidSignature(user.signature)) {
        this.logger.warn(`TravelRule PDF skipped for user ${user.id}: unrecognised signature format`);
        continue;
      }

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
        // A failing rollback leaves a claim leak (date set, no valid file) — the observer's
        // claimedWithoutFile metric surfaces it, but the error must not be swallowed silently.
        await this.userRepo
          .update({ id: user.id }, { travelRulePdfDate: null })
          .catch((rollbackError) =>
            this.logger.error(`TravelRule PDF claim rollback failed for user ${user.id}`, rollbackError),
          );
        await this.invalidateOrphanFile(user.userData.id, originalName);
        this.logger.error(`TravelRule PDF failed for user ${user.id}`, e);
      }
    }
  }

  // *** HELPER METHODS *** //

  // Fail-closed allowlist of known address-ownership signature formats. Deliberately conservative so
  // it never rejects a valid signature; the exact allowlist scope is Compliance-sign-off-pending
  // (open question Q1, DECISION_NEEDED). Empirical format distribution from the sheet `archiv!J`
  // full scan (27.296 non-empty cells): Monero base58, EVM hex (0x + 130/146 hex), Bitcoin base64
  // (`H…`, len ~88), Cardano CIP-30 COSE (hex prefix `8458`, optionally with a `;<key>` suffix).
  // A UUID is excluded explicitly — it can never cryptographically prove address ownership.
  private static readonly UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  private static readonly SIGNATURE_FORMATS: RegExp[] = [
    /^0x[0-9a-fA-F]{130}$/, // EVM personal_sign (65-byte r/s/v)
    /^0x[0-9a-fA-F]{146}$/, // EVM long variant observed in the archive (73 bytes)
    /^8458[0-9a-fA-F]+$/, // Cardano CIP-8/CIP-30 COSE_Sign1 (CBOR), key part handled below
    /^[H-K][0-9A-Za-z+/]{86,88}={0,2}$/, // Bitcoin message signature, base64 (65 bytes → ~88 chars)
    /^[1-9A-HJ-NP-Za-km-z]{90,}$/, // Monero base58 (long, no 0/O/I/l)
  ];

  private isValidSignature(signature?: string): boolean {
    if (!signature) return false;

    // a `;<key>` suffix (Cardano CIP-30) is verification-relevant — validate only the signature part
    const value = signature.split(';')[0];

    if (TravelRuleJobService.UUID_REGEX.test(value)) return false;

    return TravelRuleJobService.SIGNATURE_FORMATS.some((format) => format.test(value));
  }

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
    if (orphan)
      await this.kycFileService
        .invalidateKycFile(orphan.id)
        .catch((e) => this.logger.error(`TravelRule PDF orphan invalidation failed for file ${orphan.id}`, e));
  }
}
