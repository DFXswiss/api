import { Config } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface UserMailInput {
  userData: UserData;
  translationKey: string;
  translationParams: object;
}

export interface UserMailTable {
  text: string;
  value: string;
}

export interface UserMailAffix {
  url?: {
    link: string;
    text: string;
    textSuffix?: string;
  };
  mail?: {
    address: string;
    textSuffix?: string;
  };
  style: string;
  text: string;
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

export interface UserMailParamsNew {
  to: string;
  subject: string;
  salutation: string;
  prefix: UserMailAffix[];
  table: UserMailTable[];
  suffix: UserMailAffix[];
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

export class UserMailNew extends Mail {
  constructor(params: UserMailParamsNew) {
    const defaultParams: Partial<UserMailParamsNew> = {
      twitterUrl: Config.defaultTwitterUrl,
      telegramUrl: Config.defaultTelegramUrl,
      linkedinUrl: Config.defaultLinkedinUrl,
      instagramUrl: Config.defaultInstagramUrl,
    };

    super({ ...params, template: 'userNew', templateParams: { ...defaultParams, ...params } });
  }
}
