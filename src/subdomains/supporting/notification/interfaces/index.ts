import { ErrorMonitoringMailInput } from '../entities/mail/error-monitoring-mail';
import { MailRequestInternalInput } from '../entities/mail/internal-mail';
import { MailRequestPersonalInput } from '../entities/mail/personal-mail';
import { MailRequestUserInput } from '../entities/mail/user-mail';
import { MailRequestUserInputV2 } from '../entities/mail/user-mail-v2';
import { NotificationOptions } from '../entities/notification.entity';
import { MailContext, MailType } from '../enums';

export interface MailRequest {
  type: MailType;
  context: MailContext;
  input:
    | MailRequestGenericInput
    | ErrorMonitoringMailInput
    | MailRequestUserInput
    | MailRequestUserInputV2
    | MailRequestPersonalInput
    | MailRequestInternalInput;
  correlationId?: string;
  options?: NotificationOptions;
}

export interface MailAffix {
  url?: {
    link: string;
    text: string;
    textSuffix?: string;
    button: string;
  };
  mail?: {
    address: string;
    textSuffix?: string;
    button: string;
  };
  style?: string;
  marginTop?: string;
  marginBottom?: string;
  underline?: string;
  text: string;
}

export enum MailParamKey {
  STYLE = 'style',
  VALUE = 'value',
  URL = 'url',
  BUTTON = 'button',
  UNDERLINE = 'underline',
  MARGIN_TOP = 'marginTop',
  MARGIN_BOTTOM = 'marginBottom',
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
