import { GetConfig } from 'src/config/config';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './mail';

export type ErrorMailInput = ErrorMailParams;

export interface ErrorMailParams {
  subject: string;
  errors: string[];
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

// technical support mail - monitoring
export class ErrorMail extends Mail {
  constructor(params: ErrorMailParams) {
    const _params = {
      to: GetConfig().mail.contact.monitoringMail,
      subject: `${params.subject} (${GetConfig().environment.toUpperCase()})`,
      salutation: 'Hi DFX Tech Support',
      body: ErrorMail.createBody(params.errors),
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
