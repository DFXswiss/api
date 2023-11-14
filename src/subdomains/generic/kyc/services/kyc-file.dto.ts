export enum KycFileType {
  NAME_CHECK = 'NameCheck',
  USER_INFORMATION = 'UserInformation',
  IDENTIFICATION = 'Identification',
  USER_NOTES = 'UserNotes',
  TRANSACTION_NOTES = 'TransactionNotes',
}

export enum KycContentType {
  TEXT = 'text/plain',
  // TODO
}

export interface KycFile {
  type: KycFileType;
  name: string;
  url: string;
  contentType: KycContentType;
  created: Date;
  updated: Date;
  metadata: Record<string, string>;
}
