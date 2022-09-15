import { GetConfig } from 'src/config/config';
import { UserData } from 'src/user/models/user-data/user-data.entity';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './mail';

export interface KycMailInput {
  userData: UserData;
  kycCustomerId: string;
}

export interface KycMailParams {
  userDataId: number;
  kycCustomerId: string;
  kycStatus: string;
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

// support -
export class KycSupportMail extends Mail {
  constructor(params: KycMailParams) {
    const _params = {
      to: GetConfig().mail.contact.supportMail,
      subject: 'KYC failed or expired',
      salutation: 'Hi DFX Support',
      body: KycSupportMail.createBody(params),
      metadata: params.metadata,
      options: params.options,
    };

    super(_params);
  }

  static createBody(params: KycMailParams): string {
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
