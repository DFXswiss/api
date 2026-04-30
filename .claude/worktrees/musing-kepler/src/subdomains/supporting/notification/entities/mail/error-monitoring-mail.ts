import { GetConfig } from 'src/config/config';
import { NotificationOptions } from '../notification.entity';
import { Mail, MailParams } from './base/mail';

export type ErrorMonitoringMailInput = ErrorMonitoringMailParams;

export interface ErrorMonitoringMailParams {
  subject: string;
  errors: string[];
  isLiqMail?: boolean;
  correlationId?: string;
  options?: NotificationOptions;
}

export class ErrorMonitoringMail extends Mail {
  constructor(params: ErrorMonitoringMailParams) {
    const to = [GetConfig().mail.contact.monitoringMail];
    if (params.isLiqMail) to.push(GetConfig().mail.contact.liqMail);

    const env = GetConfig().environment.toUpperCase();

    const _params: MailParams = {
      to: to,
      subject: `${params.subject} (${env})`,
      correlationId: params.correlationId,
      options: params.options,
      templateParams: {
        salutation: `${env} API`,
        body: ErrorMonitoringMail.createBody(params.errors),
        date: new Date().getFullYear(),
      },
    };

    super(_params);
  }

  static createBody(errors: string[]): string {
    return `
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    `;
  }
}
