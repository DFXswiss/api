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
  date?: number;
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
}
