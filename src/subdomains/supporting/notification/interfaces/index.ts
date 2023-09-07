import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { ErrorMonitoringMailInput } from '../entities/mail/error-monitoring-mail';
import { KycSupportMailInput } from '../entities/mail/kyc-support-mail';
import { UserMailInput } from '../entities/mail/user-mail';
import { NotificationMetadata, NotificationOptions } from '../entities/notification.entity';
import { MailType } from '../enums';

export interface MailRequest {
  type: MailType;
  input: MailRequestGenericInput | UserMailInput | KycSupportMailInput | ErrorMonitoringMailInput;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export interface MailRequestNew {
  type: MailType;
  input: MailRequestGenericInput | ErrorMonitoringMailInput | MailRequestUser | MailRequestPersonal;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export interface MailRequestUser {
  userData: UserData;
  title: string;
  salutation?: TranslationItem;
  prefix?: TranslationItem[];
  table?: Record<string, string>;
  suffix?: TranslationItem[];
}

export interface MailRequestPersonal {
  userData: UserData;
  title: string;
  salutation?: TranslationItem;
  prefix?: TranslationItem[];
  from?: string;
  displayName?: string;
  banner?: string;
}

export interface MailAffix {
  url?: {
    link: string;
    text: string;
    textSuffix?: string;
  };
  mail?: {
    address: string;
    textSuffix?: string;
  };
  style?: string;
  text: string;
}

export enum MailParamKey {
  STYLE = 'style',
  VALUE = 'value',
  URL = 'url',
}

export type TranslationParams = { [key in MailParamKey]?: string } | Record<string, string>;

export interface TranslationItem {
  key: string;
  params?: TranslationParams;
}

export interface MailRequestGenericInput {
  to: string;
  subject: string;
  salutation: string;
  body: string;
  from?: string;
  displayName?: string;
  cc?: string;
  bcc?: string;
  template?: string;
  banner?: string;
  date?: number;
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
}
