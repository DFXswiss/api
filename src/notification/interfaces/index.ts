import { ErrorMailInput } from '../entities/mail/error-mail';
import { KycMailInput } from '../entities/mail/kyc-mail';
import { UserMailInput } from '../entities/mail/user-mail';
import { NotificationMetadata, NotificationOptions } from '../entities/notification.entity';
import { MailType } from '../enums';

export interface MailRequest {
  type: MailType;
  input: MailRequestGenericInput | UserMailInput | KycMailInput | ErrorMailInput;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export interface MailRequestGenericInput {
  from?: { name: string; address: string };
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  template?: string;
  salutation?: string;
  body?: string;
  date?: number;
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
}
