import { ApiProperty } from '@nestjs/swagger';
import { KycWebhookStatus } from '../../../services/webhook/dto/kyc-webhook.dto';

export class KycDataDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: KycWebhookStatus })
  kycStatus: KycWebhookStatus;

  @ApiProperty()
  kycHash: string;
}
