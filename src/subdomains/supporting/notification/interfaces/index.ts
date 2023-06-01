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
  input: MailRequestGenericInput | ErrorMonitoringMailInput | MailRequestInput;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export interface MailRequestInput {
  userData: UserData;
  title: string;
  prefix: TranslationItem[];
  table: Record<string, string>;
  suffix: TranslationItem[];
}

export interface TranslationItem {
  key: string;
  params?: Record<string, string>;
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
