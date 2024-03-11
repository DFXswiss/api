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
    reason: string;
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

export function getIdentResult(dto: IdentResultDto): IdentShortResult {
  return IdentResultMap[dto.identificationprocess.result];
}
