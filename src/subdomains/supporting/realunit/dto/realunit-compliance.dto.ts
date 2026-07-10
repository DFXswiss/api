import { IsOptional, IsString } from 'class-validator';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import {
  BuySupportInfo,
  CountrySupportInfo,
  LanguageSupportInfo,
  OrganizationSupportInfo,
  SellSupportInfo,
  SupportMessageSupportInfo,
  SwapSupportInfo,
  VirtualIbanSupportInfo,
} from 'src/subdomains/generic/support/dto/user-data-support.dto';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycLevel, KycStatus, KycType } from 'src/subdomains/generic/user/models/user-data/user-data.enum';

// Reduced, whitelist-only view a RealUnit staff member gets for one of their OWN customers. Everything is
// constructed field-by-field from scratch (never the full DFX dossier minus keys), so no DFX-internal or AML
// work-product field can ever leak by omission or drift. The nested collection DTOs below are RealUnit-specific and
// STRUCTURALLY omit every DFX AML work product / compliance note (see the per-DTO notes) per the product owner's
// reduced-compliance-scope decision (2026-07-03).

export class RealUnitCustomerSearchQuery {
  @IsOptional()
  @IsString()
  key?: string;
}

export class RealUnitCustomerListDto {
  id: number;
  kycStatus: KycStatus;
  kycLevel?: KycLevel;
  accountType?: AccountType;
  mail?: string;
  name?: string;
}

export class RealUnitKycFileDto {
  uid: string;
  type: FileType;
  name: string;
  created: Date;
}

// Reduced KYC step: `result`/`comment` (raw internal step data + potential DFX compliance note) and the
// recommendation/referral graph are intentionally omitted per the reduced-compliance-scope decision.
export class RealUnitDossierKycStepDto {
  id: number;
  name: string;
  type?: string;
  status: string;
  sequenceNumber: number;
  created: Date;
}

// Reduced transaction: `amlCheck`/`amlReason` (DFX AML verdict + reasoning) and `comment` (potential DFX compliance
// note) are intentionally omitted per the reduced-compliance-scope decision.
export class RealUnitDossierTxDto {
  id: number;
  uid: string;
  buyCryptoId?: number;
  buyFiatId?: number;
  bankDataId?: number;
  type?: string;
  sourceType: string;
  inputAmount?: number;
  inputAsset?: string;
  inputTxId?: string;
  outputAmount?: number;
  outputAsset?: string;
  amountInChf?: number;
  amountInEur?: number;
  chargebackDate?: Date;
  isCompleted: boolean;
  created: Date;
}

// Reduced bank data: `comment` (potential DFX compliance note) and the cross-customer `alternatives` list are
// intentionally omitted per the reduced-compliance-scope decision.
export class RealUnitDossierBankDataDto {
  id: number;
  iban: string;
  name: string;
  type?: string;
  status?: string;
  approved: boolean;
  manualApproved?: boolean;
  active: boolean;
  created: Date;
}

export class RealUnitDossierSupportIssueTxDto {
  id: number;
  uid: string;
  type?: string;
  sourceType: string;
  amountInChf?: number;
}

// Reduced support issue: the `limitRequest` object (DFX AML/compliance limit assessment; already redacted for
// REALUNIT in PR-1) and the nested `transaction.amlCheck` (DFX AML verdict) are intentionally omitted per the
// reduced-compliance-scope decision.
export class RealUnitDossierSupportIssueDto {
  id: number;
  uid: string;
  type: string;
  state: string;
  reason: string;
  name: string;
  clerk?: string;
  department?: string;
  information?: string;
  messages: SupportMessageSupportInfo[];
  transaction?: RealUnitDossierSupportIssueTxDto;
  created: Date;
}

// One resolved check evidence: the api decides which step/file counts as the evidence (api = decision authority),
// the dashboard renders it 1:1. `status`/`type` are only set for step-backed checks (ident; type = KycStepType,
// e.g. SumsubAuto/SumsubVideo/Video/Manual); `fileUid`/`fileName` point at the downloadable evidence when one exists.
export class RealUnitCheckEvidenceDto {
  status?: string;
  type?: string;
  date: Date;
  fileUid?: string;
  fileName?: string;
}

// The mandatory checks of the RealUnit dossier. An absent member means the check is missing — the dashboard must
// render that as a compliance finding, never hide the row.
export class RealUnitChecksDto {
  identCheck?: RealUnitCheckEvidenceDto;
  nameCheck?: RealUnitCheckEvidenceDto;
}

export class RealUnitCustomerDetailDto {
  // --- Identity / PII (RealUnit is the responsible financial intermediary for its own customers) --- //
  id: number;
  created: Date;
  accountType?: AccountType;
  mail?: string;
  firstname?: string;
  surname?: string;
  verifiedName?: string;
  street?: string;
  houseNumber?: string;
  zip?: string;
  location?: string;
  country?: CountrySupportInfo;
  nationality?: CountrySupportInfo;
  language?: LanguageSupportInfo;
  birthday?: Date;
  phone?: string;
  organization?: OrganizationSupportInfo;

  // --- KYC / compliance status (no DFX-generated AML work products) --- //
  kycStatus: KycStatus;
  kycLevel?: KycLevel;
  kycType?: KycType;
  highRisk?: boolean;
  pep?: boolean;

  // --- Mandatory checks, resolved by the api (absent member = check missing) --- //
  checks: RealUnitChecksDto;

  // --- Customer-scoped slices (reduced, AML work products structurally omitted) --- //
  kycFiles: RealUnitKycFileDto[];
  kycSteps: RealUnitDossierKycStepDto[];
  transactions: RealUnitDossierTxDto[];
  bankDatas: RealUnitDossierBankDataDto[];
  buyRoutes: BuySupportInfo[];
  sellRoutes: SellSupportInfo[];
  swapRoutes: SwapSupportInfo[];
  virtualIbans: VirtualIbanSupportInfo[];
  supportIssues: RealUnitDossierSupportIssueDto[];
}
