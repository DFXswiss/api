import { Injectable } from '@nestjs/common';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { FileSubType, FileType } from '../dto/kyc-file.dto';
import { KycFile } from '../entities/kyc-file.entity';
import { KycStep } from '../entities/kyc-step.entity';
import { NameCheckLogRepository } from '../repositories/name-check-log.repository';
import { DfxApprovalPdfService } from './dfx-approval-pdf.service';
import { KycDocumentService } from './integration/kyc-document.service';

export const DFX_APPROVAL_GENERATED_DOCUMENTS = [
  FileSubType.GWG_FILE_COVER,
  FileSubType.IDENTIFICATION_FORM,
  FileSubType.CUSTOMER_PROFILE,
  FileSubType.RISK_PROFILE,
  FileSubType.FORM_A,
  FileSubType.DFX_NAME_CHECK,
] as const;

@Injectable()
export class DfxApprovalDocumentService {
  constructor(
    private readonly nameCheckLogRepo: NameCheckLogRepository,
    private readonly pdfService: DfxApprovalPdfService,
    private readonly documentService: KycDocumentService,
  ) {}

  async generateMissingPersonalDocuments(
    userData: UserData,
    step: KycStep,
    files: KycFile[],
    requestedDocuments: readonly FileSubType[] = DFX_APPROVAL_GENERATED_DOCUMENTS,
  ): Promise<void> {
    const missing = requestedDocuments.filter(
      (subType) => !files.some((file) => file.subType === subType && file.valid),
    );
    if (!missing.length) return;

    const nameCheck = await this.nameCheckLogRepo.findOne({
      where: { userData: { id: userData.id } },
      order: { created: 'DESC' },
    });
    if (missing.includes(FileSubType.DFX_NAME_CHECK) && !nameCheck)
      throw new Error(`NameCheck evidence is missing for userData ${userData.id}`);

    const generatedAt = new Date();
    const failures: string[] = [];
    for (const subType of missing) {
      try {
        const context = { userData, steps: userData.kycSteps, nameCheck, generatedAt };
        const data = await this.pdfService.generate(subType, context);
        const version = 'v1';
        const generationKey = `dfx-approval:${userData.id}:${subType}:${version}`;
        await this.documentService.ensureGeneratedUserFile(
          generationKey,
          userData,
          FileType.USER_NOTES,
          subType,
          this.pdfService.fileName(subType, context),
          data,
          { workflow: 'DfxApproval', version, stepId: String(step.id) },
        );
      } catch (error) {
        failures.push(`${subType}: ${(error as Error).message}`);
      }
    }
    if (failures.length) throw new Error(`DfxApproval document generation failed (${failures.join('; ')})`);
  }
}
