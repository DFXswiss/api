import { Config } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { MailAffix, TranslationItem } from '../../interfaces';
import { NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface MailRequestUserInput {
  userData: UserData;
  wallet: Wallet;
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
  constructor(params: UserMailParams, wallet: Wallet) {
    const defaultParams: Partial<UserMailParams> = {
      twitterUrl: Config.social.twitter,
      telegramUrl: Config.social.telegram,
      linkedinUrl: Config.social.linkedin,
      instagramUrl: Config.social.instagram,
    };

    super({
      ...params,
      template: wallet?.name === 'onchainlabs' ? 'onChainLabs' : 'user',
      templateParams: { ...defaultParams, ...params },
    });
  }
}
