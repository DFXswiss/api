import { ApiProperty } from '@nestjs/swagger';
import { FileSubType } from '../kyc-file.dto';

export enum DfxApprovalBlocker {
  WRONG_ACCOUNT_TYPE = 'WrongAccountType',
  WRONG_STEP_STATUS = 'WrongStepStatus',
  WRONG_KYC_LEVEL = 'WrongKycLevel',
  MISSING_VERIFIED_NAME = 'MissingVerifiedName',
  MISSING_KYC_HASH = 'MissingKycHash',
  MISSING_FIRST_NAME = 'MissingFirstName',
  MISSING_BIRTHDAY = 'MissingBirthday',
  MISSING_MAIL = 'MissingMail',
  COMPLEX_ORGANIZATION = 'ComplexOrganization',
  RISK_DATA_PENDING = 'RiskDataPending',
  HIGH_RISK = 'HighRisk',
  PEP = 'Pep',
  INVALID_USER_STATUS = 'InvalidUserStatus',
  INVALID_KYC_STATUS = 'InvalidKycStatus',
  MISSING_COUNTRY = 'MissingCountry',
  COUNTRY_DISABLED = 'CountryDisabled',
  COUNTRY_REQUIRES_MANUAL_REVIEW = 'CountryRequiresManualReview',
  COUNTRY_EXCLUDED = 'CountryExcluded',
  MISSING_NATIONALITY = 'MissingNationality',
  NATIONALITY_DISABLED = 'NationalityDisabled',
  MISSING_RESIDENCE_PERMIT = 'MissingResidencePermit',
  MISSING_IDENT_DOCUMENT_TYPE = 'MissingIdentDocumentType',
  IDENT_DOCUMENT_TYPE_DISABLED = 'IdentDocumentTypeDisabled',
  MISSING_IDENT_DOCUMENT_ID = 'MissingIdentDocumentId',
  OPEN_NAME_CHECK = 'OpenNameCheck',
  MISSING_DOCUMENT = 'MissingDocument',
}

export class DfxApprovalBlockerDto {
  @ApiProperty({ enum: DfxApprovalBlocker })
  code: DfxApprovalBlocker;

  @ApiProperty({ enum: FileSubType, required: false })
  documentSubType?: FileSubType;
}

export class DfxApprovalStatusDto {
  @ApiProperty()
  ready: boolean;

  @ApiProperty({ type: DfxApprovalBlockerDto, isArray: true })
  blockers: DfxApprovalBlockerDto[];
}
