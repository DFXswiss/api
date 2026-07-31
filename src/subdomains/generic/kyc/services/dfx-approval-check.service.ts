import { Injectable } from '@nestjs/common';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLevel, KycStatus, UserDataStatus } from '../../user/models/user-data/user-data.enum';
import { IdentDocumentType } from '../dto/ident-result-data.dto';
import { FileSubType } from '../dto/kyc-file.dto';
import { DfxApprovalBlocker, DfxApprovalBlockerDto, DfxApprovalStatusDto } from '../dto/output/dfx-approval-status.dto';
import { KycFile } from '../entities/kyc-file.entity';
import { KycStep } from '../entities/kyc-step.entity';
import { KycStepName } from '../enums/kyc-step-name.enum';
import { ReviewStatus } from '../enums/review-status.enum';

export const DFX_APPROVAL_REQUIRED_DOCUMENTS = [
  FileSubType.GWG_FILE_COVER,
  FileSubType.IDENT_REPORT,
  FileSubType.IDENTIFICATION_FORM,
  FileSubType.CUSTOMER_PROFILE,
  FileSubType.RISK_PROFILE,
  FileSubType.FORM_A,
  FileSubType.DFX_NAME_CHECK,
  FileSubType.PERSONAL_NAME_CHECK,
] as const;

@Injectable()
export class DfxApprovalCheckService {
  evaluatePersonal(
    userData: UserData,
    step: KycStep,
    files: KycFile[],
    hasOpenNameChecks: boolean,
  ): DfxApprovalStatusDto {
    const blockers: DfxApprovalBlockerDto[] = [];
    const add = (code: DfxApprovalBlocker, documentSubType?: FileSubType): void => {
      blockers.push({ code, documentSubType });
    };

    if (userData.accountType !== AccountType.PERSONAL) add(DfxApprovalBlocker.WRONG_ACCOUNT_TYPE);
    if (step.name !== KycStepName.DFX_APPROVAL || step.status !== ReviewStatus.MANUAL_REVIEW)
      add(DfxApprovalBlocker.WRONG_STEP_STATUS);
    if (userData.kycLevel !== KycLevel.LEVEL_40) add(DfxApprovalBlocker.WRONG_KYC_LEVEL);

    if (!userData.verifiedName) add(DfxApprovalBlocker.MISSING_VERIFIED_NAME);
    if (!userData.kycHash) add(DfxApprovalBlocker.MISSING_KYC_HASH);
    if (!userData.firstname) add(DfxApprovalBlocker.MISSING_FIRST_NAME);
    if (!userData.birthday) add(DfxApprovalBlocker.MISSING_BIRTHDAY);
    if (!userData.mail) add(DfxApprovalBlocker.MISSING_MAIL);
    if (userData.complexOrgStructure !== false) add(DfxApprovalBlocker.COMPLEX_ORGANIZATION);

    if (userData.highRisk == null || userData.pep == null) add(DfxApprovalBlocker.RISK_DATA_PENDING);
    if (userData.highRisk === true) add(DfxApprovalBlocker.HIGH_RISK);
    if (userData.pep === true) add(DfxApprovalBlocker.PEP);

    if (![UserDataStatus.NA, UserDataStatus.ACTIVE, UserDataStatus.KYC_ONLY].includes(userData.status))
      add(DfxApprovalBlocker.INVALID_USER_STATUS);
    if (![KycStatus.NA, KycStatus.COMPLETED].includes(userData.kycStatus)) add(DfxApprovalBlocker.INVALID_KYC_STATUS);

    const country = userData.verifiedCountry ?? userData.country;
    if (!country) {
      add(DfxApprovalBlocker.MISSING_COUNTRY);
    } else {
      if (!country.dfxEnable) add(DfxApprovalBlocker.COUNTRY_DISABLED);
      if (country.manualReviewRequired) add(DfxApprovalBlocker.COUNTRY_REQUIRES_MANUAL_REVIEW);
      if (country.symbol === 'BR') add(DfxApprovalBlocker.COUNTRY_EXCLUDED);
      if (!userData.identDocumentType) {
        add(DfxApprovalBlocker.MISSING_IDENT_DOCUMENT_TYPE);
      } else if (!country.isKycDocEnabled(userData.identDocumentType as IdentDocumentType)) {
        add(DfxApprovalBlocker.IDENT_DOCUMENT_TYPE_DISABLED);
      }
    }

    const residencePermitSteps = userData.getStepsWith(KycStepName.RESIDENCE_PERMIT);
    const hasCompletedResidencePermit = residencePermitSteps.some((residencePermit) => residencePermit.isCompleted);
    if (!userData.nationality) {
      add(DfxApprovalBlocker.MISSING_NATIONALITY);
    } else if (!userData.nationality.nationalityEnable && !hasCompletedResidencePermit) {
      add(DfxApprovalBlocker.NATIONALITY_DISABLED);
    }

    if (residencePermitSteps.length > 0 && !hasCompletedResidencePermit)
      add(DfxApprovalBlocker.MISSING_RESIDENCE_PERMIT);

    if (!userData.identDocumentId) add(DfxApprovalBlocker.MISSING_IDENT_DOCUMENT_ID);
    if (hasOpenNameChecks) add(DfxApprovalBlocker.OPEN_NAME_CHECK);

    for (const documentSubType of DFX_APPROVAL_REQUIRED_DOCUMENTS) {
      if (!files.some((file) => file.valid && file.subType === documentSubType))
        add(DfxApprovalBlocker.MISSING_DOCUMENT, documentSubType);
    }

    return { ready: blockers.length === 0, blockers };
  }
}
