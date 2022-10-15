import { GetConfig } from 'src/config/config';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export type ErrorMonitoringMailInput = ErrorMonitoringMailParams;

export interface ErrorMonitoringMailParams {
  subject: string;
  errors: string[];
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export class ErrorMonitoringMail extends Mail {
  constructor(params: ErrorMonitoringMailParams) {
    const _params = {
      to: GetConfig().mail.contact.monitoringMail,
      subject: `${params.subject} (${GetConfig().environment.toUpperCase()})`,
      salutation: 'Hi DFX Tech Support',
      body: ErrorMonitoringMail.createBody(params.errors),
      metadata: params.metadata,
      options: params.options,
    };

    super(_params);
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
