import { ContentType } from '../enums/content-type.enum';
import { FileSubType } from './kyc-file.dto';

export interface IdentConfig {
  customer: string;
  apiKey: string;
}

export interface IdentDocument {
  name: string;
  content: Buffer;
  contentType: ContentType;
  fileSubType?: FileSubType;
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
