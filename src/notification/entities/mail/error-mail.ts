import { GetConfig } from 'src/config/config';
import { NotificationParams } from '../notification.entity';
import { Mail, OptionalMailParams } from './mail';

export interface ErrorMailInput {
  subject: string;
  errors: string[];
}

export interface ErrorMailParams {
  subject: string;
  errors: string[];
  notificationParams: NotificationParams;
}

// technical support mail - monitoring
export class ErrorMail extends Mail {
  constructor(params: ErrorMailParams, optional?: OptionalMailParams) {
    const mailParams = {
      to: GetConfig().mail.contact.monitoringMail,
      subject: `${params.subject} (${GetConfig().environment.toUpperCase()})`,
      salutation: 'Hi DFX Tech Support',
      body: ErrorMail.createBody(params.errors),
      notificationParams: params.notificationParams,
    };

    super(mailParams, optional);
  }

  static createBody(errors: string[]): string {
    const env = GetConfig().environment.toUpperCase();

    return `
    <p>there seem to be some problems on ${env} API:</p>
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    `;
  }
}
