import { Injectable } from '@nestjs/common';
import { ScorechainScreening } from 'src/integration/scorechain/entities/scorechain-screening.entity';
import { ScorechainPdfService } from 'src/integration/scorechain/services/scorechain-pdf.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { FileSubType, FileType } from '../dto/kyc-file.dto';
import { ContentType } from '../enums/content-type.enum';
import { KycDocumentService } from './integration/kyc-document.service';

@Injectable()
export class ScorechainDocumentService {
  private readonly logger = new DfxLogger(ScorechainDocumentService);

  constructor(
    private readonly scorechainPdfService: ScorechainPdfService,
    private readonly kycDocumentService: KycDocumentService,
  ) {}

  // Stores a screening verdict as a compliance document (KycFile UserNotes / BlockchainAddressAnalysis)
  // on the customer's userData. Side-effect only: a PDF-render or storage failure must NEVER break the
  // AML/screening flow that triggered it, so we log loudly and swallow.
  async createScreeningReport(userData: UserData, screening: ScorechainScreening): Promise<void> {
    try {
      const pdf = await this.scorechainPdfService.generate(screening);
      const name = `${Util.isoDate(new Date()).replace(/-/g, '')}-ScorechainScreening-${userData.id}-${
        screening.objectId
      }-${Util.isoTime(new Date()).replace(/-/g, '')}.pdf`;

      await this.kycDocumentService.uploadFile(
        userData,
        FileType.USER_NOTES,
        name,
        pdf,
        ContentType.PDF,
        true,
        true,
        undefined,
        FileSubType.BLOCKCHAIN_ADDRESS_ANALYSIS,
      );
    } catch (e) {
      this.logger.error(
        `Failed to store Scorechain screening report for user ${userData.id}, screening ${screening.id}:`,
        e,
      );
    }
  }
}
