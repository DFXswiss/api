import { ErrorMailInput } from '../entities/mail/error-mail';
import { KycMailInput } from '../entities/mail/kyc-mail';
import { UserMailInput } from '../entities/mail/user-mail';
import { NotificationOptions } from '../entities/notification.entity';
import { MailContext, MailType } from '../enums';

export interface MailRequest {
  context: MailContext;
  correlationId: string;
  type: MailType;
  data: MailRequestGenericInput & UserMailInput & KycMailInput & ErrorMailInput;
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
