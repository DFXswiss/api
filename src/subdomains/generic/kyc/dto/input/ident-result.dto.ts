export enum IdentResult {
  REVIEW_PENDING = 'REVIEW_PENDING',
  CHECK_PENDING = 'CHECK_PENDING',
  FRAUD_SUSPICION_PENDING = 'FRAUD_SUSPICION_PENDING',
  SUCCESS = 'SUCCESS',
  SUCCESS_DATA_CHANGED = 'SUCCESS_DATA_CHANGED',
  ABORTED = 'ABORTED',
  CANCELED = 'CANCELED',
  FRAUD_SUSPICION_CONFIRMED = 'FRAUD_SUSPICION_CONFIRMED',
}

export enum IdentReason {
  ID_OTHER = 'ID_OTHER',
  ID_DAMAGED = 'ID_DAMAGED',
  ID_NOT_SUPPORTED = 'ID_NOT_SUPPORTED',
  ID_BLURRY = 'ID_BLURRY',
  ID_GLARE = 'ID_GLARE',
  ID_DARKNESS = 'ID_DARKNESS',
  ID_DATA_COVERED = 'ID_DATA_COVERED',
  ID_PERSPECTIVE = 'ID_PERSPECTIVE',
  ID_DATA = 'ID_DATA',
  ID_DATA_OTHER = 'ID_DATA_OTHER',
  ID_EXPIRED = 'ID_EXPIRED',
  ID_WRONG_SIDE = 'ID_WRONG_SIDE',
  ID_OUTWORN = 'ID_OUTWORN',
  ID_HAS_STICKER = 'ID_HAS_STICKER',
  ID_WRITTEN_ON = 'ID_WRITTEN_ON',
  ID_BROKEN = 'ID_BROKEN',
  ID_DAMAGED_OTHER = 'ID_DAMAGED_OTHER',
  ID_SECURITY_FEATURE_NOT_VISIBLE_NOT_FRAUD = 'ID_SECURITY_FEATURE_NOT_VISIBLE_NOT_FRAUD',
  ID_SECURITY_FEATURE_VIDEO_SHORT = 'ID_SECURITY_FEATURE_VIDEO_SHORT',
  ID_SECURITY_FEATURE_VIDEO_CANNOT_BE_PLAYED = 'ID_SECURITY_FEATURE_VIDEO_CANNOT_BE_PLAYED',
  ID_SECURITY_FEATURE_OTHER = 'ID_SECURITY_FEATURE_OTHER',
  ID_SECOND_DOCUMENT = 'ID_SECOND_DOCUMENT',
  ID_SECOND_DOCUMENT_BAD_PHOTO_QUALITY = 'ID_SECOND_DOCUMENT_BAD_PHOTO_QUALITY',
  ID_SECOND_DOCUMENT_DAMAGED = 'ID_SECOND_DOCUMENT_DAMAGED',
  ID_SECOND_DOCUMENT_EXPIRED = 'ID_SECOND_DOCUMENT_EXPIRED',
  ID_SECOND_DOCUMENT_OTHER = 'ID_SECOND_DOCUMENT_OTHER',
  ID_NEED_ADDITIONAL_DOCUMENT = 'ID_NEED_ADDITIONAL_DOCUMENT',
  USER_INVOICE_MISSING = 'USER_INVOICE_MISSING',
  USER_OBSCURED = 'USER_OBSCURED',
  SELFIE_BLURRY = 'SELFIE_BLURRY',
  SELFIE_GLARE = 'SELFIE_GLARE',
  SELFIE_DARKNESS = 'SELFIE_DARKNESS',
  SELFIE_PERSPECTIVE = 'SELFIE_PERSPECTIVE',
  SELFIE_OTHER = 'SELFIE_OTHER',
  IDENT_CANNOT_BE_COMPLETED = 'IDENT_CANNOT_BE_COMPLETED',
  IDENT_DISPLAY_ERROR = 'IDENT_DISPLAY_ERROR',
  IDENT_OTHER = 'IDENT_OTHER',
  TSP_WRONG_CONFIRMATION_TOKEN = 'TSP_WRONG_CONFIRMATION_TOKEN',
  TSP_SIGNING_FAILED = 'TSP_SIGNING_FAILED',
  TSP_CERTIFICATE_EXPIRED = 'TSP_CERTIFICATE_EXPIRED',
  ID_SECURITY_FEATURE_VIDEO_FILE_MISSING = 'ID_SECURITY_FEATURE_VIDEO_FILE_MISSING',
}

export enum IdentShortResult {
  CANCEL = 'Cancel',
  ABORT = 'Abort',
  REVIEW = 'Review',
  SUCCESS = 'Success',
  FAIL = 'Fail',
}

export enum IdentItemStatus {
  MATCH = 'MATCH',
  CHANGE = 'CHANGE',
  NEW = 'NEW',
  ORIGINAL = 'ORIGINAL',
}

export interface IdentItem {
  status: IdentItemStatus;
  value: string;
  original?: string;
}

export class IdentResultDto {
  identificationprocess: {
    result: IdentResult;
    reason: IdentReason;
    companyid: string;
    filename: string;
    agentname: string;
    identificationtime: string;
    id: string;
    href: string;
    type: string;
    transactionnumber: string;
  };
  contactdata: {
    mobilephone?: string;
    email?: string;
  };
  userdata: {
    birthday: IdentItem;
    birthname: IdentItem;
    firstname: IdentItem;
    gender: IdentItem;
    address?: {
      zipcode: IdentItem;
      country: IdentItem;
      city: IdentItem;
      street: IdentItem;
      streetnumber: IdentItem;
    };
    birthplace: IdentItem;
    nationality: IdentItem;
    identlanguage: IdentItem;
    lastname: IdentItem;
  };
  identificationdocument: {
    country: IdentItem;
    number: IdentItem;
    issuedby: IdentItem;
    dateissued: IdentItem;
    type: IdentItem;
    validuntil: IdentItem;
  };
  attachments: {
    pdf: string;
    audiolog: string;
    xml: string;
    idbackside: string;
    livenessscreenshot1: string;
    idfrontside: string;
    userface: string;
  };
}

const IdentResultMap: Record<IdentResult, IdentShortResult> = {
  [IdentResult.REVIEW_PENDING]: IdentShortResult.REVIEW,
  [IdentResult.CHECK_PENDING]: IdentShortResult.REVIEW,
  [IdentResult.FRAUD_SUSPICION_PENDING]: IdentShortResult.REVIEW,
  [IdentResult.SUCCESS]: IdentShortResult.SUCCESS,
  [IdentResult.SUCCESS_DATA_CHANGED]: IdentShortResult.SUCCESS,
  [IdentResult.ABORTED]: IdentShortResult.ABORT,
  [IdentResult.CANCELED]: IdentShortResult.CANCEL,
  [IdentResult.FRAUD_SUSPICION_CONFIRMED]: IdentShortResult.FAIL,
};

const IdentReasonMap: Record<IdentReason, string> = {
  [IdentReason.ID_OTHER]: 'Other issues with the document used in the identification process',
  [IdentReason.ID_DAMAGED]: 'Document used during identification is a damaged document',
  [IdentReason.ID_NOT_SUPPORTED]: 'Document used during the identification is not supported for the customers use case',
  [IdentReason.ID_BLURRY]: 'Document is blurry and mandatory data cannot be read',
  [IdentReason.ID_GLARE]: 'Document has glare and mandatory data cannot be read',
  [IdentReason.ID_DARKNESS]:
    'Pictures of the document are dark and it is not possible to read the mandatory data or verify the authenticity of the document',
  [IdentReason.ID_DATA_COVERED]: 'Mandatory data is covered while taking the picture',
  [IdentReason.ID_PERSPECTIVE]:
    'Document is positioned at such an angle that mandatory data cannot be read or document cannot be verified',
  [IdentReason.ID_DATA]: 'Mandatory data cannot be read on the document',
  [IdentReason.ID_DATA_OTHER]: 'Other reason due to which mandatory data cannot be read',
  [IdentReason.ID_EXPIRED]: 'Document used during the identification is expired',
  [IdentReason.ID_WRONG_SIDE]: 'Wrong side of the document is scanned during the process',
  [IdentReason.ID_OUTWORN]: 'Document is worn out. Either data cannot be read out or the document cannot be verified',
  [IdentReason.ID_HAS_STICKER]:
    'Document has such stickers which are not acceptable and the document used is considered as damaged document',
  [IdentReason.ID_WRITTEN_ON]:
    'Document has text written over it which makes the document not readable or not verifiable',
  [IdentReason.ID_BROKEN]: 'Document used during the identification is broken',
  [IdentReason.ID_DAMAGED_OTHER]: 'Other reason for a damaged document',
  [IdentReason.ID_SECURITY_FEATURE_NOT_VISIBLE_NOT_FRAUD]:
    'Security features of the document are not visible because you did not move the document correctly',
  [IdentReason.ID_SECURITY_FEATURE_VIDEO_SHORT]:
    'Security feature video is too short to detect if there are holograms in the document',
  [IdentReason.ID_SECURITY_FEATURE_VIDEO_CANNOT_BE_PLAYED]:
    'Security feature video cannot be played for the agent to review holograms',
  [IdentReason.ID_SECURITY_FEATURE_OTHER]: 'Other issues with the security feature video',
  [IdentReason.ID_SECOND_DOCUMENT]: 'Two documents are required for the identification process',
  [IdentReason.ID_SECOND_DOCUMENT_BAD_PHOTO_QUALITY]:
    'Photo quality of the additional document in the process is not acceptable',
  [IdentReason.ID_SECOND_DOCUMENT_DAMAGED]:
    'Additional document used in the identification process is severely outworn, written or drawn on, ripped or broken',
  [IdentReason.ID_SECOND_DOCUMENT_EXPIRED]:
    'Additional document used in the identification process is an expired document',
  [IdentReason.ID_SECOND_DOCUMENT_OTHER]:
    'Other issues with the additional document used in the identification process',
  [IdentReason.ID_NEED_ADDITIONAL_DOCUMENT]:
    'Additional document like Drivers License is missing in the identification process',
  [IdentReason.USER_INVOICE_MISSING]: 'Proof of address is needed from you as the additional document',
  [IdentReason.USER_OBSCURED]:
    'You covered your face during the face comparison process unintentionally like wearing the face mask',
  [IdentReason.SELFIE_BLURRY]:
    'Selfie taken is blurry and cannot be used to compare the face with the identification document',
  [IdentReason.SELFIE_GLARE]: 'Photo of you on the ID document has glares and selfie cannot be compared with it',
  [IdentReason.SELFIE_DARKNESS]:
    'Your selfie is too dark to compare the face of the person with the photo on the identification document',
  [IdentReason.SELFIE_PERSPECTIVE]:
    'Your selfie is on such an angle that it is not possible to compare it with the photo on the identification document',
  [IdentReason.SELFIE_OTHER]: 'Other issues with the selfie',
  [IdentReason.IDENT_CANNOT_BE_COMPLETED]:
    'Due to a technical reason, ident specialist cannot finish the identity verification process',
  [IdentReason.IDENT_DISPLAY_ERROR]:
    'Due to a technical reason, ident specialist cannot see your data in the identification process',
  [IdentReason.IDENT_OTHER]:
    'Other reason due to which the identification process cannot be completed by the ident specialist',
  [IdentReason.TSP_WRONG_CONFIRMATION_TOKEN]: 'You entered a wrong signing code during the signing step',
  [IdentReason.TSP_SIGNING_FAILED]: 'The signing process failed due to any technical error',
  [IdentReason.TSP_CERTIFICATE_EXPIRED]:
    'Signing certificates are valid for an hour. The final signing step took more than an hour from the time of certificate generation',
  [IdentReason.ID_SECURITY_FEATURE_VIDEO_FILE_MISSING]:
    'Security Features (Hologram) video is not saved due to any technical error',
};

export function getIdentResult(dto: IdentResultDto): IdentShortResult {
  return IdentResultMap[dto.identificationprocess.result];
}

export function getIdentReason(reason: IdentReason | string): string {
  return IdentReasonMap[reason] ?? reason;
}
