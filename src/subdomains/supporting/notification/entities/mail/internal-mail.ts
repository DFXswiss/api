import { MailAffix, MailRequestGenericBase, TranslationItem } from '../../interfaces';
import { NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface MailRequestInternalInput extends MailRequestGenericBase {
  title: string;
  salutation?: TranslationItem;
  prefix?: TranslationItem[];
}

export interface InternalMailParams extends MailRequestGenericBase {
  subject: string;
  salutation: string;
  prefix: MailAffix[];
  correlationId?: string;
  options?: NotificationOptions;
}

export class InternalMail extends Mail {
  constructor(params: InternalMailParams) {
    super({ ...params, template: 'internal', templateParams: params });
  }
}
