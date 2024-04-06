import { Config } from 'src/config/config';
import { Language } from 'src/shared/models/language/language.entity';
import { MailAffix, TranslationItem } from '../../interfaces';
import { NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface MailRequestUserInput {
  userData: { id: number; mail: string; language: Language };
  title: string;
  salutation?: TranslationItem;
  prefix?: TranslationItem[];
  table?: Record<string, string>;
  suffix?: TranslationItem[];
}

export interface UserMailTable {
  text: string;
  value: string;
}

export interface UserMailParams {
  to: string;
  subject: string;
  salutation: string;
  prefix: MailAffix[];
  table: UserMailTable[];
  suffix: MailAffix[];
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  correlationId?: string;
  options?: NotificationOptions;
}

export class UserMail extends Mail {
  constructor(params: UserMailParams) {
    const defaultParams: Partial<UserMailParams> = {
      twitterUrl: Config.social.twitter,
      telegramUrl: Config.social.telegram,
      linkedinUrl: Config.social.linkedin,
      instagramUrl: Config.social.instagram,
    };

    super({ ...params, template: 'user', templateParams: { ...defaultParams, ...params } });
  }
}
