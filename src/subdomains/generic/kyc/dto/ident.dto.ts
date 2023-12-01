import { KycContentType } from './kyc-file.dto';

export interface IdentConfig {
  customer: string;
  apiKey: string;
}

export interface IdentDocument {
  name: string;
  content: Buffer;
  contentType: KycContentType;
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
