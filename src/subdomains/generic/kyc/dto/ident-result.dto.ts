export enum IdNowResultType {
  REVIEW_PENDING = 'REVIEW_PENDING',
  CHECK_PENDING = 'CHECK_PENDING',
  FRAUD_SUSPICION_PENDING = 'FRAUD_SUSPICION_PENDING',
  SUCCESS = 'SUCCESS',
  SUCCESS_DATA_CHANGED = 'SUCCESS_DATA_CHANGED',
  ABORTED = 'ABORTED',
  CANCELED = 'CANCELED',
  FRAUD_SUSPICION_CONFIRMED = 'FRAUD_SUSPICION_CONFIRMED',
}

export enum IdNowReason {
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
  PENDING = 'Pending',
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

export interface IdNowResult {
  identificationprocess: {
    result: IdNowResultType;
    reason: IdNowReason;
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

const IdNowResultMap: Record<IdNowResultType, IdentShortResult> = {
  [IdNowResultType.REVIEW_PENDING]: IdentShortResult.REVIEW,
  [IdNowResultType.CHECK_PENDING]: IdentShortResult.REVIEW,
  [IdNowResultType.FRAUD_SUSPICION_PENDING]: IdentShortResult.REVIEW,
  [IdNowResultType.SUCCESS]: IdentShortResult.SUCCESS,
  [IdNowResultType.SUCCESS_DATA_CHANGED]: IdentShortResult.SUCCESS,
  [IdNowResultType.ABORTED]: IdentShortResult.ABORT,
  [IdNowResultType.CANCELED]: IdentShortResult.CANCEL,
  [IdNowResultType.FRAUD_SUSPICION_CONFIRMED]: IdentShortResult.FAIL,
};

const IdNowReasonMap: Record<IdNowReason, string> = {
  [IdNowReason.ID_OTHER]: 'Other issues with the document used in the identification process',
  [IdNowReason.ID_DAMAGED]: 'Document used during identification is a damaged document',
  [IdNowReason.ID_NOT_SUPPORTED]: 'Document used during the identification is not supported for the customers use case',
  [IdNowReason.ID_BLURRY]: 'Document is blurry and mandatory data cannot be read',
  [IdNowReason.ID_GLARE]: 'Document has glare and mandatory data cannot be read',
  [IdNowReason.ID_DARKNESS]:
    'Pictures of the document are dark and it is not possible to read the mandatory data or verify the authenticity of the document',
  [IdNowReason.ID_DATA_COVERED]: 'Mandatory data is covered while taking the picture',
  [IdNowReason.ID_PERSPECTIVE]:
    'Document is positioned at such an angle that mandatory data cannot be read or document cannot be verified',
  [IdNowReason.ID_DATA]: 'Mandatory data cannot be read on the document',
  [IdNowReason.ID_DATA_OTHER]: 'Other reason due to which mandatory data cannot be read',
  [IdNowReason.ID_EXPIRED]: 'Document used during the identification is expired',
  [IdNowReason.ID_WRONG_SIDE]: 'Wrong side of the document is scanned during the process',
  [IdNowReason.ID_OUTWORN]: 'Document is worn out. Either data cannot be read out or the document cannot be verified',
  [IdNowReason.ID_HAS_STICKER]:
    'Document has such stickers which are not acceptable and the document used is considered as damaged document',
  [IdNowReason.ID_WRITTEN_ON]:
    'Document has text written over it which makes the document not readable or not verifiable',
  [IdNowReason.ID_BROKEN]: 'Document used during the identification is broken',
  [IdNowReason.ID_DAMAGED_OTHER]: 'Other reason for a damaged document',
  [IdNowReason.ID_SECURITY_FEATURE_NOT_VISIBLE_NOT_FRAUD]:
    'Security features of the document are not visible because you did not move the document correctly',
  [IdNowReason.ID_SECURITY_FEATURE_VIDEO_SHORT]:
    'Security feature video is too short to detect if there are holograms in the document',
  [IdNowReason.ID_SECURITY_FEATURE_VIDEO_CANNOT_BE_PLAYED]:
    'Security feature video cannot be played for the agent to review holograms',
  [IdNowReason.ID_SECURITY_FEATURE_OTHER]: 'Other issues with the security feature video',
  [IdNowReason.ID_SECOND_DOCUMENT]: 'Two documents are required for the identification process',
  [IdNowReason.ID_SECOND_DOCUMENT_BAD_PHOTO_QUALITY]:
    'Photo quality of the additional document in the process is not acceptable',
  [IdNowReason.ID_SECOND_DOCUMENT_DAMAGED]:
    'Additional document used in the identification process is severely outworn, written or drawn on, ripped or broken',
  [IdNowReason.ID_SECOND_DOCUMENT_EXPIRED]:
    'Additional document used in the identification process is an expired document',
  [IdNowReason.ID_SECOND_DOCUMENT_OTHER]:
    'Other issues with the additional document used in the identification process',
  [IdNowReason.ID_NEED_ADDITIONAL_DOCUMENT]:
    'Additional document like Drivers License is missing in the identification process',
  [IdNowReason.USER_INVOICE_MISSING]: 'Proof of address is needed from you as the additional document',
  [IdNowReason.USER_OBSCURED]:
    'You covered your face during the face comparison process unintentionally like wearing the face mask',
  [IdNowReason.SELFIE_BLURRY]:
    'Selfie taken is blurry and cannot be used to compare the face with the identification document',
  [IdNowReason.SELFIE_GLARE]: 'Photo of you on the ID document has glares and selfie cannot be compared with it',
  [IdNowReason.SELFIE_DARKNESS]:
    'Your selfie is too dark to compare the face of the person with the photo on the identification document',
  [IdNowReason.SELFIE_PERSPECTIVE]:
    'Your selfie is on such an angle that it is not possible to compare it with the photo on the identification document',
  [IdNowReason.SELFIE_OTHER]: 'Other issues with the selfie',
  [IdNowReason.IDENT_CANNOT_BE_COMPLETED]:
    'Due to a technical reason, ident specialist cannot finish the identity verification process',
  [IdNowReason.IDENT_DISPLAY_ERROR]:
    'Due to a technical reason, ident specialist cannot see your data in the identification process',
  [IdNowReason.IDENT_OTHER]:
    'Other reason due to which the identification process cannot be completed by the ident specialist',
  [IdNowReason.TSP_WRONG_CONFIRMATION_TOKEN]: 'You entered a wrong signing code during the signing step',
  [IdNowReason.TSP_SIGNING_FAILED]: 'The signing process failed due to any technical error',
  [IdNowReason.TSP_CERTIFICATE_EXPIRED]:
    'Signing certificates are valid for an hour. The final signing step took more than an hour from the time of certificate generation',
  [IdNowReason.ID_SECURITY_FEATURE_VIDEO_FILE_MISSING]:
    'Security Features (Hologram) video is not saved due to any technical error',
};

export function getIdentResult(dto: IdNowResult): IdentShortResult {
  return IdNowResultMap[dto.identificationprocess.result];
}

export function getIdNowIdentReason(reason: IdNowReason | string): string {
  return IdNowReasonMap[reason] ?? reason;
}
