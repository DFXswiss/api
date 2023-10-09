import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { MailAffix, TranslationItem } from '../../interfaces';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface MailRequestPersonalInput {
  userData: UserData;
  title: string;
  salutation?: TranslationItem;
  prefix?: TranslationItem[];
  from?: string;
  displayName?: string;
  banner?: string;
}

export interface PersonalMailParams {
  to: string;
  subject: string;
  prefix: MailAffix[];
  banner: string;
  from?: string;
  displayName?: string;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export class PersonalMail extends Mail {
  constructor(params: PersonalMailParams) {
    super({ ...params, template: 'personal', templateParams: params });
  }
}
