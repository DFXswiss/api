import { UserData } from 'src/user/models/user-data/user-data.entity';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './mail';

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
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export class UserMail extends Mail {
  constructor(params: UserMailParams) {
    super({ ...params, template: 'default' });
  }
}
