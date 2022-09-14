import { UserData } from 'src/user/models/user-data/user-data.entity';
import { NotificationParams } from '../notification.entity';
import { Mail, OptionalMailParams } from './mail';

export interface UserMailInput {
  userData: UserData;
  translationKey: string;
  translationParams: string;
}

export interface UserMailParams {
  to: string;
  subject: string;
  salutation: string;
  body: string;
  notificationParams: NotificationParams;
}

export class UserMail extends Mail {
  constructor(params: UserMailParams, optional: OptionalMailParams = {}) {
    super(params, { ...optional, template: 'default' });
  }
}
