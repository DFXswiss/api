import { KycWebhookStatus } from '../../../services/webhook/dto/kyc-webhook.dto';

export class KycDataDto {
  address: string;
  kycStatus: KycWebhookStatus;
  kycHash: string;
}
