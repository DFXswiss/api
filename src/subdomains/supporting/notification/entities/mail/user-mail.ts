import { Config } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface UserMailInput {
  userData: UserData;
  translationKey: string;
  translationParams: object;
}

export interface UserMailParams {
  to: string;
  subject: string;
  salutation: string;
  body: string;
  telegramUrl?: string;
  twitterUrl?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export class UserMail extends Mail {
  constructor(params: UserMailParams) {
    const defaultParams: Partial<UserMailParams> = {
      twitterUrl: Config.defaultTwitterUrl,
      telegramUrl: Config.defaultTelegramUrl,
      linkedinUrl: Config.defaultLinkedinUrl,
      instagramUrl: Config.defaultInstagramUrl,
    };

    super({ ...params, template: 'user', templateParams: { ...defaultParams, ...params } });
  }
}
