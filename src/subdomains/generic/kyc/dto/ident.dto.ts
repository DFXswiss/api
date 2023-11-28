export interface IdentConfig {
  customer: string;
  apiKey: string;
}

export interface IdentDocument {
  name: string;
  content: Buffer;
}

export interface IdentDocuments {
  pdf: IdentDocument;
  zip: IdentDocument;
}

export enum IdentStatus {
  SUCCESS = 'success',
  CANCEL = 'cancel',
}

export enum IdentChannel {
  WEB = 'web',
  IOS = 'ios',
  ANDROID = 'android',
}
