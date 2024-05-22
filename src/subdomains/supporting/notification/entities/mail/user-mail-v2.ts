import { Config } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { MailAffix, TranslationItem } from '../../interfaces';
import { NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface MailRequestUserInputV2 {
  userData: UserData;
  title: string;
  salutation?: TranslationItem;
  texts: TranslationItem[];
}

export interface UserMailParamsV2 {
  to: string;
  subject: string;
  salutation: string;
  texts: MailAffix[];
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  correlationId?: string;
  options?: NotificationOptions;
}

export class UserMailV2 extends Mail {
  constructor(params: UserMailParamsV2) {
    const defaultParams: Partial<UserMailParamsV2> = {
      twitterUrl: Config.social.twitter,
      telegramUrl: Config.social.telegram,
      linkedinUrl: Config.social.linkedin,
      instagramUrl: Config.social.instagram,
    };

    super({ ...params, template: 'userV2', templateParams: { ...defaultParams, ...params } });
  }
}
