import { IdentDocumentType } from './ident-result-data.dto';
import { IdentShortResult } from './ident-result.dto';

export interface SumsubResult {
  webhook: SumSubWebhookResult;
  data: SumSubDataResult;
}

export interface SumSubWebhookResult {
  applicantId?: string;
  applicantActionId?: string;
  applicantType?: ApplicantType;
  inspectionId?: string;
  correlationId?: string;
  externalUserId?: string;
  externalApplicantActionId?: string;
  levelName?: SumSubLevelName;
  previousLevelName?: string;
  type?: SumSubWebhookType;
  reviewResult?: SumSubReviewResult;
  reviewStatus?: SumSubReviewStatus;
  videoIdentReviewStatus?: SumSubReviewStatus;
  createdAt: Date;
  createdAtMs?: Date;
  sandboxMode?: boolean;
  clientId?: string;
  reviewMode?: string;
}

export interface SumSubDataResult {
  id?: string;
  createdAt?: Date;
  clientId?: string;
  inspectionId?: string;
  externalUserId?: string;
  sourceKey?: string;
  info?: {
    firstName?: string;
    firstNameEn?: string;
    lastName?: string;
    lastNameEn?: string;
    dob?: string;
    country?: string;
    idDocs?: [
      {
        idDocType?: IdDocType;
        country?: string;
        firstName?: string;
        firstNameEn?: string;
        lastName?: string;
        lastNameEn?: string;
        validUntil?: Date;
        number?: string;
        dob?: Date;
        mrzLine1?: string;
        mrzLine2?: string;
        mrzLine3?: string;
      },
    ];
  };
  requiredIdDocs?: string;
  fixedInfo?: {
    firstName?: string;
    firstNameEn?: string;
    lastName?: string;
    lastNameEn?: string;
    country?: string;
  };
  email?: string;
  phone?: string;
  applicantPlatform?: string;
  ipCountry?: string;
  authCode?: string;
  agreement?: { createdAt?: Date; source?: string; acceptedAt?: string; recordIds?: string[] };
}

export interface SumSubDocumentMetaData {
  items: [
    {
      id: string;
      previewId: string;
      addedDate: Date;
      fileMetadata: {
        fileName: string;
        fileType: string;
        fileSize: string;
        resolution: { width: string; height: string };
      };
      idDocDef?: { country?: string; idDocType?: IdDocType; idDocSubType?: IdDocSubType };
      reviewResult: SumSubReviewResult;
      attemptId: string;
      source: DocumentSource;
      deactivated: boolean;
    },
  ];
  totalItems: number;
}

export interface SumSubReviewResult {
  reviewAnswer: ReviewAnswer;
  moderationComment?: string;
  clientComment?: string;
  rejectLabels?: SumSubRejectionLabels[];
  reviewRejectType?: ReviewRejectType;
  buttonIds?: string[];
}

export interface SumSubVideoData {
  id?: string;
  videoIdentData?: {
    reviewStatus?: string;
    moderatorDisplayName?: string;
    compositions: SumSubComposition[];
  };
}

export interface SumSubComposition {
  compositionCreatedAt?: Date;
  compositionDuration?: number;
  compositionMediaId?: string;
}

export enum DocumentSource {
  LIVENESS = 'liveness',
  VIDEO_IDENT = 'videoident',
  DOCAPTURE = 'docapture',
  NFC = 'nfc',
  EXTERNAL_DB = 'externaldb',
  FILE_UPLOAD = 'fileupload',
}

export enum IdDocType {
  AGREEMENT = 'AGREEMENT',
  ARBITRARY_DOC = 'ARBITRARY_DOC',
  BANK_CARD = 'BANK_CARD',
  CONTRACT = 'CONTRACT',
  COVID_VACCINATION_FORM = 'COVID_VACCINATION_FORM',
  DRIVERS = 'DRIVERS',
  DRIVERS_TRANSLATION = 'DRIVERS_TRANSLATION',
  FILE_ATTACHMENT = 'FILE_ATTACHMENT',
  ID_CARD = 'ID_CARD',
  ID_DOC_PHOTO = 'ID_DOC_PHOTO',
  INCOME_SOURCE = 'INCOME_SOURCE',
  INVESTOR_DOC = 'INVESTOR_DOC',
  PASSPORT = 'PASSPORT',
  PAYMENT_SOURCE = 'PAYMENT_SOURCE',
  PROFILE_IMAGE = 'PROFILE_IMAGE',
  RESIDENCE_PERMIT = 'RESIDENCE_PERMIT',
  SELFIE = 'SELFIE',
  UTILITY_BILL = 'UTILITY_BILL',
  UTILITY_BILL2 = 'UTILITY_BILL2',
  VEHICLE_REGISTRATION_CERTIFICATE = 'VEHICLE_REGISTRATION_CERTIFICATE',
  VIDEO_SELFIE = 'VIDEO_SELFIE',
  OTHER = 'OTHER',
}

export enum IdDocSubType {
  FRONT_SIDE = 'FRONT_SIDE',
  BACK_SIDE = 'BACK_SIDE',
}

export enum ApplicantType {
  COMPANY = 'company',
  INDIVIDUAL = 'individual',
}

export enum ReviewAnswer {
  GREEN = 'GREEN',
  RED = 'RED',
}

export enum ReviewRejectType {
  FINAL = 'FINAL',
  RETRY = 'RETRY',
}

export enum SumSubReviewStatus {
  INIT = 'init',
  PENDING = 'pending',
  PRE_CHECKED = 'prechecked',
  QUEUED = 'queued',
  COMPLETED = 'completed',
  ON_HOLD = 'onHold',
}

export enum SumSubLevelName {
  CH_STANDARD = 'CH-Standard',
  CH_STANDARD_VIDEO = 'CH-Standard-Video',
}

export enum SumSubWebhookType {
  APPLICANT_CREATED = 'applicantCreated',
  APPLICANT_PENDING = 'applicantPending',
  APPLICANT_REVIEWED = 'applicantReviewed',
  APPLICANT_ON_HOLD = 'applicantOnHold',
  APPLICANT_ACTION_PENDING = 'applicantActionPending',
  APPLICANT_ACTION_REVIEWED = 'applicantActionReviewed',
  APPLICANT_ACTION_ON_HOLD = 'applicantActionOnHold',
  APPLICANT_PERSONAL_INFO_CHANGED = 'applicantPersonalInfoChanged',
  APPLICANT_TAGS_CHANGED = 'applicantTagsChanged',
  APPLICANT_ACTIVATED = 'applicantActivated',
  APPLICANT_DEACTIVATED = 'applicantDeactivated',
  APPLICANT_DELETED = 'applicantDeleted',
  APPLICANT_RESET = 'applicantReset',
  APPLICANT_PRECHECKED = 'applicantPrechecked',
  APPLICANT_LEVEL_CHANGED = 'applicantLevelChanged',
  APPLICANT_WORKFLOW_COMPLETED = 'applicantWorkflowCompleted',
  VIDEO_IDENT_STATUS_CHANGED = 'videoIdentStatusChanged',
  VIDEO_IDENT_COMPOSITION_COMPLETED = 'videoIdentCompositionCompleted',
}

export enum SumSubRejectionLabels {
  //TEMP
  APPLICANT_INTERRUPTED_INTERVIEW = 'APPLICANT_INTERRUPTED_INTERVIEW',
  ADDITIONAL_DOCUMENT_REQUIRED = 'ADDITIONAL_DOCUMENT_REQUIRED',
  BACK_SIDE_MISSING = 'BACK_SIDE_MISSING',
  BAD_AVATAR = 'BAD_AVATAR',
  BAD_FACE_MATCHING = 'BAD_FACE_MATCHING',
  BAD_PROOF_OF_ADDRESS = 'BAD_PROOF_OF_ADDRESS',
  BAD_PROOF_OF_IDENTITY = 'BAD_PROOF_OF_IDENTITY',
  BAD_PROOF_OF_PAYMENT = 'BAD_PROOF_OF_PAYMENT',
  BAD_SELFIE = 'BAD_SELFIE',
  BAD_VIDEO_SELFIE = 'BAD_VIDEO_SELFIE',
  BLACK_AND_WHITE = 'BLACK_AND_WHITE',
  COMPANY_NOT_DEFINED_BENEFICIARIES = 'COMPANY_NOT_DEFINED_BENEFICIARIES',
  COMPANY_NOT_DEFINED_REPRESENTATIVES = 'COMPANY_NOT_DEFINED_REPRESENTATIVES',
  COMPANY_NOT_DEFINED_STRUCTURE = 'COMPANY_NOT_DEFINED_STRUCTURE',
  COMPANY_NOT_VALIDATED_BENEFICIARIES = 'COMPANY_NOT_VALIDATED_BENEFICIARIES',
  COMPANY_NOT_VALIDATED_REPRESENTATIVES = 'COMPANY_NOT_VALIDATED_REPRESENTATIVES',
  CONNECTION_INTERRUPTED = 'CONNECTION_INTERRUPTED',
  DIGITAL_DOCUMENT = 'DIGITAL_DOCUMENT',
  DOCUMENT_DEPRIVED = 'DOCUMENT_DEPRIVED',
  DOCUMENT_DAMAGED = 'DOCUMENT_DAMAGED',
  DOCUMENT_MISSING = 'DOCUMENT_MISSING',
  DOCUMENT_PAGE_MISSING = 'DOCUMENT_PAGE_MISSING',
  EXPIRATION_DATE = 'EXPIRATION_DATE',
  FRONT_SIDE_MISSING = 'FRONT_SIDE_MISSING',
  GRAPHIC_EDITOR = 'GRAPHIC_EDITOR',
  ID_INVALID = 'ID_INVALID',
  INCOMPATIBLE_LANGUAGE = 'INCOMPATIBLE_LANGUAGE',
  INCOMPLETE_DOCUMENT = 'INCOMPLETE_DOCUMENT',
  INCORRECT_SOCIAL_NUMBER = 'INCORRECT_SOCIAL_NUMBER',
  PROBLEMATIC_APPLICANT_DATA = 'PROBLEMATIC_APPLICANT_DATA',
  REQUESTED_DATA_MISMATCH = 'REQUESTED_DATA_MISMATCH',
  SELFIE_WITH_PAPER = 'SELFIE_WITH_PAPER',
  LOW_QUALITY = 'LOW_QUALITY',
  NOT_ALL_CHECKS_COMPLETED = 'NOT_ALL_CHECKS_COMPLETED',
  SCREENSHOTS = 'SCREENSHOTS',
  UNFILLED_ID = 'UNFILLED_ID',
  UNSATISFACTORY_PHOTOS = 'UNSATISFACTORY_PHOTOS',
  UNSUITABLE_ENV = 'UNSUITABLE_ENV',
  WRONG_ADDRESS = 'WRONG_ADDRESS',
  //FINAL
  ADVERSE_MEDIA = 'ADVERSE_MEDIA',
  AGE_REQUIREMENT_MISMATCH = 'AGE_REQUIREMENT_MISMATCH',
  BLACKLIST = 'BLACKLIST',
  BLOCKLIST = 'BLOCKLIST',
  CHECK_UNAVAILABLE = 'CHECK_UNAVAILABLE',
  COMPROMISED_PERSONS = 'COMPROMISED_PERSONS',
  CRIMINAL = 'CRIMINAL',
  DB_DATA_MISMATCH = 'DB_DATA_MISMATCH',
  DB_DATA_NOT_FOUND = 'DB_DATA_NOT_FOUND',
  DOCUMENT_TEMPLATE = 'DOCUMENT_TEMPLATE',
  DUPLICATE = 'DUPLICATE',
  EXPERIENCE_REQUIREMENT_MISMATCH = 'EXPERIENCE_REQUIREMENT_MISMATCH',
  FORGERY = 'FORGERY',
  FRAUDULENT_LIVENESS = 'FRAUDULENT_LIVENESS',
  FRAUDULENT_PATTERNS = 'FRAUDULENT_PATTERNS',
  INCONSISTENT_PROFILE = 'INCONSISTENT_PROFILE',
  PEP = 'PEP',
  REGULATIONS_VIOLATIONS = 'REGULATIONS_VIOLATIONS',
  SANCTIONS = 'SANCTIONS',
  SELFIE_MISMATCH = 'SELFIE_MISMATCH',
  SPAM = 'SPAM',
  NOT_DOCUMENT = 'NOT_DOCUMENT',
  THIRD_PARTY_INVOLVED = 'THIRD_PARTY_INVOLVED',
  UNSUPPORTED_LANGUAGE = 'UNSUPPORTED_LANGUAGE',
  WRONG_USER_REGION = 'WRONG_USER_REGION',
}

export const SumSubBlockLabels = [
  SumSubRejectionLabels.FORGERY,
  SumSubRejectionLabels.CRIMINAL,
  SumSubRejectionLabels.DOCUMENT_DEPRIVED,
  SumSubRejectionLabels.BLACKLIST,
  SumSubRejectionLabels.BLOCKLIST,
  SumSubRejectionLabels.FRAUDULENT_PATTERNS,
  SumSubRejectionLabels.SANCTIONS,
  SumSubRejectionLabels.FRAUDULENT_LIVENESS,
  SumSubRejectionLabels.THIRD_PARTY_INVOLVED,
];

const SumSubReasonMap: Record<SumSubRejectionLabels, string> = {
  [SumSubRejectionLabels.FORGERY]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.CRIMINAL]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.DOCUMENT_DEPRIVED]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.BLACKLIST]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.BLOCKLIST]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.FRAUDULENT_PATTERNS]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.SANCTIONS]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.FRAUDULENT_LIVENESS]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.THIRD_PARTY_INVOLVED]: 'You are not allowed to complete KYC',
  [SumSubRejectionLabels.DOCUMENT_TEMPLATE]: 'The submitted documents are templates downloaded from the internet',
  [SumSubRejectionLabels.DIGITAL_DOCUMENT]: 'You uploaded a digital version of the document',
  [SumSubRejectionLabels.LOW_QUALITY]: 'Documents have low-quality that does not allow definitive decisions to be made',
  [SumSubRejectionLabels.SPAM]: 'Spam detected (irrelevant images were supplied)',
  [SumSubRejectionLabels.NOT_DOCUMENT]: 'The submitted documents are not relevant for the verification procedure',
  [SumSubRejectionLabels.SELFIE_MISMATCH]: 'Your photo does not match a photo on the provided documents',
  [SumSubRejectionLabels.ID_INVALID]: 'Your ident document is not valid',
  [SumSubRejectionLabels.DUPLICATE]: 'Duplicates are not allowed by the regulations',
  [SumSubRejectionLabels.BAD_AVATAR]: 'Your avatar does not meet our requirements',
  [SumSubRejectionLabels.WRONG_USER_REGION]: 'Your country/region is not allowed',
  [SumSubRejectionLabels.INCOMPLETE_DOCUMENT]:
    'Some information is missing from the document, or it is only partially visible',
  [SumSubRejectionLabels.WRONG_ADDRESS]: 'The address on your documents does not match the address you entered',
  [SumSubRejectionLabels.UNSATISFACTORY_PHOTOS]:
    'Problems with the photos during verification, like poor quality or masked information',
  [SumSubRejectionLabels.GRAPHIC_EDITOR]: 'The document has been edited by a graphical editor',
  [SumSubRejectionLabels.DOCUMENT_PAGE_MISSING]: 'Some pages of a document are missing',
  [SumSubRejectionLabels.DOCUMENT_DAMAGED]: 'Your document is damaged',
  [SumSubRejectionLabels.REGULATIONS_VIOLATIONS]: 'Violations of regulations were found',
  [SumSubRejectionLabels.INCONSISTENT_PROFILE]: 'Data or documents of different persons were uploaded',
  [SumSubRejectionLabels.PROBLEMATIC_APPLICANT_DATA]: 'Applicant data does not match the data in your documents',
  [SumSubRejectionLabels.ADDITIONAL_DOCUMENT_REQUIRED]: 'Additional documents are required to pass the check',
  [SumSubRejectionLabels.AGE_REQUIREMENT_MISMATCH]: 'The age requirement (18 years) is not met',
  [SumSubRejectionLabels.REQUESTED_DATA_MISMATCH]:
    'Provided information does not match with the data from the document',
  [SumSubRejectionLabels.EXPERIENCE_REQUIREMENT_MISMATCH]: 'You do not have enough experience',
  [SumSubRejectionLabels.COMPROMISED_PERSONS]: 'You correspond to compromised person politics',
  [SumSubRejectionLabels.PEP]: 'You belong to the PEP category',
  [SumSubRejectionLabels.ADVERSE_MEDIA]: 'You were found in the adverse media',
  [SumSubRejectionLabels.NOT_ALL_CHECKS_COMPLETED]: 'Not all of the checks were completed',
  [SumSubRejectionLabels.FRONT_SIDE_MISSING]: 'The front side of the document is missing',
  [SumSubRejectionLabels.BACK_SIDE_MISSING]: 'The back side of the document is missing',
  [SumSubRejectionLabels.SCREENSHOTS]: 'You uploaded screenshots',
  [SumSubRejectionLabels.BLACK_AND_WHITE]: 'You uploaded black and white photos of your documents',
  [SumSubRejectionLabels.INCOMPATIBLE_LANGUAGE]: 'A translation of your documents is required',
  [SumSubRejectionLabels.EXPIRATION_DATE]: 'You uploaded an expired document',
  [SumSubRejectionLabels.UNFILLED_ID]: 'You uploaded the document without signatures and stamps',
  [SumSubRejectionLabels.BAD_SELFIE]: 'You uploaded a selfie in poor quality',
  [SumSubRejectionLabels.BAD_VIDEO_SELFIE]: 'You uploaded a video selfie in poor quality',
  [SumSubRejectionLabels.BAD_FACE_MATCHING]: 'A face check between a document and a selfie was failed',
  [SumSubRejectionLabels.BAD_PROOF_OF_IDENTITY]: 'You uploaded a poor quality ID document',
  [SumSubRejectionLabels.BAD_PROOF_OF_ADDRESS]: 'You uploaded a poor quality proof of address',
  [SumSubRejectionLabels.BAD_PROOF_OF_PAYMENT]: 'You uploaded a poor quality proof of payment',
  [SumSubRejectionLabels.COMPANY_NOT_DEFINED_STRUCTURE]: 'The organization control structure was not defined',
  [SumSubRejectionLabels.COMPANY_NOT_DEFINED_BENEFICIARIES]:
    'The organization beneficial owners were not identified and duly verified',
  [SumSubRejectionLabels.COMPANY_NOT_VALIDATED_BENEFICIARIES]: 'The organization beneficial owners were not validated',
  [SumSubRejectionLabels.COMPANY_NOT_DEFINED_REPRESENTATIVES]: 'The organization representatives were not defined',
  [SumSubRejectionLabels.COMPANY_NOT_VALIDATED_REPRESENTATIVES]: 'The organization representatives were not validated',
  [SumSubRejectionLabels.APPLICANT_INTERRUPTED_INTERVIEW]:
    'You refused to finish the interview during the video ident call',
  [SumSubRejectionLabels.DOCUMENT_MISSING]:
    'You refused to show or did not have required documents during the video ident call',
  [SumSubRejectionLabels.UNSUITABLE_ENV]: 'You are either not alone or not visible during the video ident call',
  [SumSubRejectionLabels.CONNECTION_INTERRUPTED]: 'The video ident call connection was interrupted',

  [SumSubRejectionLabels.INCORRECT_SOCIAL_NUMBER]: 'Your social number is incorrect',
  [SumSubRejectionLabels.SELFIE_WITH_PAPER]: 'Unknown',
  [SumSubRejectionLabels.CHECK_UNAVAILABLE]: 'Unknown',
  [SumSubRejectionLabels.DB_DATA_MISMATCH]: 'Unknown',
  [SumSubRejectionLabels.DB_DATA_NOT_FOUND]: 'Unknown',
  [SumSubRejectionLabels.UNSUPPORTED_LANGUAGE]: 'Your language is unsupported',

  //[RejectionLabels.FOREIGNER]: 'Document from unsupported country',
  //[RejectionLabels.OTHER]: 'There is some unclassified reason of rejection',
  //[RejectionLabels.SELFIE_WITH_PAYMENT]: 'A special selfie is required',
  //[RejectionLabels.OK]: 'Unknown',
};

export function getSumsubResult(dto: SumSubWebhookResult): IdentShortResult {
  switch (dto.levelName) {
    // auto ident
    case SumSubLevelName.CH_STANDARD: {
      switch (dto.type) {
        case SumSubWebhookType.APPLICANT_PENDING:
          return IdentShortResult.REVIEW;

        case SumSubWebhookType.APPLICANT_REVIEWED:
          return dto.reviewResult.reviewAnswer === ReviewAnswer.GREEN
            ? IdentShortResult.SUCCESS
            : IdentShortResult.FAIL;
      }

      break;
    }

    // video ident
    case SumSubLevelName.CH_STANDARD_VIDEO: {
      switch (dto.type) {
        case SumSubWebhookType.APPLICANT_PENDING:
          return IdentShortResult.PENDING;

        case SumSubWebhookType.APPLICANT_REVIEWED: {
          return dto.reviewResult.reviewAnswer === ReviewAnswer.GREEN
            ? IdentShortResult.SUCCESS
            : dto.reviewResult.reviewRejectType === ReviewRejectType.RETRY
              ? IdentShortResult.RETRY
              : IdentShortResult.FAIL;
        }

        case SumSubWebhookType.VIDEO_IDENT_STATUS_CHANGED: {
          if (dto.reviewStatus === SumSubReviewStatus.QUEUED) return IdentShortResult.REVIEW;
          break;
        }

        case SumSubWebhookType.VIDEO_IDENT_COMPOSITION_COMPLETED:
          if (dto.reviewResult?.reviewAnswer === ReviewAnswer.GREEN) return IdentShortResult.MEDIA;
          break;
      }
      break;
    }
  }
}

export function getSumSubReason(reasons: SumSubRejectionLabels[]): string {
  return `<ul>${reasons.map((r) => `<li>${SumSubReasonMap[r] ?? r}</li>`).join('')}</ul>`;
}

export const IdDocTypeMap: { [t in IdDocType]: IdentDocumentType } = {
  [IdDocType.AGREEMENT]: undefined,
  [IdDocType.ARBITRARY_DOC]: undefined,
  [IdDocType.BANK_CARD]: undefined,
  [IdDocType.CONTRACT]: undefined,
  [IdDocType.COVID_VACCINATION_FORM]: undefined,
  [IdDocType.DRIVERS]: IdentDocumentType.DRIVERS_LICENSE,
  [IdDocType.DRIVERS_TRANSLATION]: IdentDocumentType.DRIVERS_TRANSLATION,
  [IdDocType.FILE_ATTACHMENT]: undefined,
  [IdDocType.ID_CARD]: IdentDocumentType.IDCARD,
  [IdDocType.ID_DOC_PHOTO]: undefined,
  [IdDocType.INCOME_SOURCE]: undefined,
  [IdDocType.INVESTOR_DOC]: undefined,
  [IdDocType.PASSPORT]: IdentDocumentType.PASSPORT,
  [IdDocType.PAYMENT_SOURCE]: undefined,
  [IdDocType.PROFILE_IMAGE]: undefined,
  [IdDocType.RESIDENCE_PERMIT]: IdentDocumentType.RESIDENCE_PERMIT,
  [IdDocType.SELFIE]: undefined,
  [IdDocType.UTILITY_BILL]: undefined,
  [IdDocType.UTILITY_BILL2]: undefined,
  [IdDocType.VEHICLE_REGISTRATION_CERTIFICATE]: undefined,
  [IdDocType.VIDEO_SELFIE]: undefined,
  [IdDocType.OTHER]: undefined,
};
