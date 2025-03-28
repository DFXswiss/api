import { ContentType } from '../enums/content-type.enum';

export interface IdentConfig {
  customer: string;
  apiKey: string;
}

export interface IdentDocument {
  name: string;
  content: Buffer;
  contentType: ContentType;
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
