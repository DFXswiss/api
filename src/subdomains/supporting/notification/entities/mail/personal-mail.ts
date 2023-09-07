import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { MailAffix } from '../../interfaces';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface PersonalMailInput {
  userData: UserData;
  translationKey: string;
  translationParams: object;
  banner: string;
  from?: string;
  displayName?: string;
}

export interface PersonalMailParams {
  to: string;
  subject: string;
  salutation: string;
  body: string;
  banner: string;
  from?: string;
  displayName?: string;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export interface PersonalMailParamsNew {
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

export class PersonalMailNew extends Mail {
  constructor(params: PersonalMailParamsNew) {
    super({ ...params, template: 'personalNew', templateParams: params });
  }
}
