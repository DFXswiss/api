import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { MailAffix, TranslationItem } from '../../interfaces';
import { NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface MailRequestPersonalInput {
  userData: UserData;
  wallet: Wallet;
  bcc?: string;
  title: string;
  salutation?: TranslationItem;
  prefix?: TranslationItem[];
  from?: string;
  displayName?: string;
  banner?: string;
}

export interface PersonalMailParams {
  to: string;
  bcc?: string;
  subject: string;
  prefix: MailAffix[];
  banner: string;
  from?: string;
  displayName?: string;
  correlationId?: string;
  options?: NotificationOptions;
}

export class PersonalMail extends Mail {
  constructor(params: PersonalMailParams) {
    super({ ...params, template: 'personal', templateParams: params });
  }
}
