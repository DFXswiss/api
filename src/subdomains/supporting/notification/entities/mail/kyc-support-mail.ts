import { GetConfig } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface KycSupportMailInput {
  userData: UserData;
}

export interface KycSupportMailParams {
  userDataId: number;
  kycCustomerId: number;
  kycStatus: string;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export class KycSupportMail extends Mail {
  constructor(params: KycSupportMailParams) {
    const _params = {
      to: GetConfig().mail.contact.supportMail,
      subject: 'KYC failed or expired',
      templateParams: {
        salutation: 'Hi DFX Support',
        body: KycSupportMail.createBody(params),
        date: new Date().getFullYear(),
      },
      metadata: params.metadata,
      options: params.options,
    };

    super(_params);
  }

  static createBody(params: KycSupportMailParams): string {
    const { userDataId, kycCustomerId, kycStatus } = params;

    return `
    <p>a customer has failed or expired during progress ${kycStatus}.</p>
      <table>
          <tr>
              <td>Reference:</td>
              <td>${userDataId}</td>
          </tr>
          <tr>
              <td>Customer ID:</td>
              <td>${kycCustomerId}</td>
          </tr>
      </table>
    `;
  }
}
