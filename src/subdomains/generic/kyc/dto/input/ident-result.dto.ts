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
  TECH_HOLOGRAM = 'TECH_HOLOGRAM',
  TECH_PHOTO = 'TECH_PHOTO',
  BAD_PHOTO_QUALITY = 'BAD_PHOTO_QUALITY',
  USER_ID = 'USER_ID',
  ID_DAMAGED = 'ID_DAMAGED',
  ID_OTHER = 'ID_OTHER',
  ID_NOT_SUPPORTED = 'ID_NOT_SUPPORTED',
  USER_WRONG_PERSON = 'USER_WRONG_PERSON',
  PHOTO_OTHER = 'PHOTO_OTHER',
  OTHER_ERROR = 'OTHER_ERROR',
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
  original: string;
}

export interface IdentResultDto {
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
    mobilephone: string;
    email: string;
  };
  userdata: {
    birthday: IdentItem;
    firstname: IdentItem;
    address: {
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
  [IdentReason.TECH_HOLOGRAM]: 'Security features on the ID document are not clearly visible',
  [IdentReason.TECH_PHOTO]: 'Photo of the ID document is not clearly captured',
  [IdentReason.ID_OTHER]:
    "Miscellaneous reason related to the ID document used during the identification like 'Expired document'",
  [IdentReason.ID_NOT_SUPPORTED]: 'ID document which is not supported by our system',
  [IdentReason.BAD_PHOTO_QUALITY]:
    'Photo of the person during selfie or liveness process and or the document is not clearly visible',
  [IdentReason.USER_ID]:
    'User used an ID document which has issues like front side of the document scanned in the back side section, wrong page of passport scanned and other miscellaneous reasons',
  [IdentReason.ID_DAMAGED]: 'Document ID chosen in the process is damaged',
  [IdentReason.USER_WRONG_PERSON]: 'User is not the person who should have performed the identification',
  [IdentReason.PHOTO_OTHER]:
    'Miscellaneous reason related to the photo quality of the document or of the person which do not fit in any of the categories',
  [IdentReason.OTHER_ERROR]: 'Other miscellaneous reason which cannot be categorized',
};

export function getIdentResult(dto: IdentResultDto): IdentShortResult {
  return IdentResultMap[dto.identificationprocess.result];
}

export function getIdentReason(reason: IdentReason | string): string {
  return IdentReasonMap[reason] ?? reason;
}
