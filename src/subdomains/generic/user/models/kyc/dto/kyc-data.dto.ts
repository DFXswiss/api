import { ApiProperty } from '@nestjs/swagger';
import { KycWebhookStatus } from '../../../services/webhook/dto/kyc-webhook.dto';

export class KycDataDto {
  @ApiProperty({ deprecated: true })
  id: string;

  @ApiProperty({ enum: KycWebhookStatus, deprecated: true })
  kycStatus: KycWebhookStatus;

  @ApiProperty({ deprecated: true })
  kycHash: string;
}
