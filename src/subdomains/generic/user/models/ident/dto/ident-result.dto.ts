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

export function IdentPending(update: IdentResultDto): boolean {
  return [IdentResult.REVIEW_PENDING, IdentResult.CHECK_PENDING, IdentResult.FRAUD_SUSPICION_PENDING].includes(
    update?.identificationprocess?.result,
  );
}

export function IdentSucceeded(update: IdentResultDto): boolean {
  return [IdentResult.SUCCESS, IdentResult.SUCCESS_DATA_CHANGED].includes(update?.identificationprocess?.result);
}

export function IdentFailed(update: IdentResultDto): boolean {
  return [IdentResult.ABORTED, IdentResult.CANCELED, IdentResult.FRAUD_SUSPICION_CONFIRMED].includes(
    update?.identificationprocess?.result,
  );
}
