export enum KycFileType {
  NAME_CHECK = 'NameCheck',
  USER_INFORMATION = 'UserInformation',
  IDENTIFICATION = 'Identification',
  USER_NOTES = 'UserNotes',
  TRANSACTION_NOTES = 'TransactionNotes',
}

export enum KycContentType {
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  JSON = 'application/json',
  PDF = 'application/pdf',
  TEXT = 'text/plain',
  XML = 'text/xml',
  ZIP = 'application/zip',
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
