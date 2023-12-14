import { ErrorMonitoringMailInput } from '../entities/mail/error-monitoring-mail';
import { MailRequestInternalInput } from '../entities/mail/internal-mail';
import { MailRequestPersonalInput } from '../entities/mail/personal-mail';
import { MailRequestUserInput } from '../entities/mail/user-mail';
import { NotificationMetadata, NotificationOptions } from '../entities/notification.entity';
import { MailType } from '../enums';

export interface MailRequest {
  type: MailType;
  input:
    | MailRequestGenericInput
    | ErrorMonitoringMailInput
    | MailRequestUserInput
    | MailRequestPersonalInput
    | MailRequestInternalInput;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
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

export interface MailRequestGenericBase {
  to: string;
  from?: string;
  displayName?: string;
  cc?: string;
  bcc?: string;
  banner?: string;
  date?: number;
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
}

export interface MailRequestGenericInput extends MailRequestGenericBase {
  subject: string;
  salutation: string;
  body: string;
  template?: string;
}
