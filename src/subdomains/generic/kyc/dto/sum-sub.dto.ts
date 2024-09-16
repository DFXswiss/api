import { IdentShortResult } from './input/ident-result.dto';

export interface SumSubResult {
  applicantId?: string;
  applicantActionId?: string;
  applicantType?: ApplicantType;
  inspectionId?: string;
  correlationId?: string;
  externalUserId?: string;
  externalApplicantActionId?: string;
  levelName?: string;
  previousLevelName?: string;
  type?: WebhookType;
  reviewResult?: {
    reviewAnswer: ReviewAnswer;
    moderationComment?: string;
    clientComment?: string;
    rejectLabels?: RejectionLabels[];
    reviewRejectType?: ReviewRejectType;
    buttonIds?: string[];
  };
  reviewStatus?: string;
  videoIdentReviewStatus?: string;
  createdAt: Date;
  createdAtMs?: Date;
  sandboxMode?: boolean;
  clientId?: string;
  reviewMode?: string;
}

export interface SumSubApplicantDocuments {
  IDENTITY: {
    reviewResult: {
      reviewAnswer: ReviewAnswer;
    };
    country: string;
    idDocType: 'ID_CARD';
    imageIds: [861042510, 1897370144];
    imageReviewResults: {
      '861042510': {
        reviewAnswer: 'GREEN';
      };
      '1897370144': {
        reviewAnswer: 'GREEN';
      };
    };
    forbidden: false;
    partialCompletion: null;
    stepStatuses: null;
    imageStatuses: [];
  };
  SELFIE: {
    reviewResult: {
      reviewAnswer: 'GREEN';
    };
    country: 'ZAF';
    idDocType: 'SELFIE';
    imageIds: [325528857];
    imageReviewResults: {
      '325528857': {
        reviewAnswer: 'GREEN';
      };
    };
    forbidden: false;
    partialCompletion: null;
    stepStatuses: null;
    imageStatuses: [];
  };
}

export enum IdDocType {
  COMPANY = 'ID_CARD',
  INDIVIDUAL = 'individual',
}

export enum ApplicantType {
  COMPANY = 'company',
  INDIVIDUAL = 'individual',
}

export enum ReviewAnswer {
  GREEN = 'green',
  RED = 'red',
}

export enum ReviewRejectType {
  FINAL = 'final',
  RETRY = 'retry',
}

export enum WebhookType {
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
}

export enum RejectionLabels {
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

export function getSumSubResult(dto: SumSubResult): IdentShortResult {
  if (dto.type == WebhookType.APPLICANT_PENDING) return IdentShortResult.REVIEW;
  if (dto.type == WebhookType.APPLICANT_REVIEWED)
    return dto.reviewResult.reviewAnswer == ReviewAnswer.GREEN ? IdentShortResult.SUCCESS : IdentShortResult.FAIL;
}
