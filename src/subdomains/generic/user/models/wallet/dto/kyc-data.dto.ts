import { KycWebhookStatus } from '../../kyc/kyc-webhook.service';

export class KycDataDto {
  address: string;
  kycStatus: KycWebhookStatus;
  kycHash: string;
}
