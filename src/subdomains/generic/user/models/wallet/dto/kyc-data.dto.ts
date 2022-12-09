import { KycWebhookStatus } from '../../../services/webhook/webhook.service';

export class KycDataDto {
  address: string;
  kycStatus: KycWebhookStatus;
  kycHash: string;
}
