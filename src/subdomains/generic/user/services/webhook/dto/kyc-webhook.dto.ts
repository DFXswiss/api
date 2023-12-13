import { ApiProperty } from '@nestjs/swagger';
import { KycLevel } from '../../../models/user-data/user-data.entity';
import { TradingLimit } from '../../../models/user/dto/user.dto';
import { WebhookDto, WebhookType } from './webhook.dto';

export enum KycWebhookStatus {
  NA = 'NA',
  LIGHT = 'Light',
  FULL = 'Full',
  REJECTED = 'Rejected',
}

export class KycWebhookData {
  @ApiProperty()
  mail: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  street: string;

  @ApiProperty()
  houseNumber: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  zip: string;

  @ApiProperty()
  phone: string;

  @ApiProperty({ enum: KycWebhookStatus, deprecated: true })
  kycStatus: KycWebhookStatus;

  @ApiProperty({ enum: KycLevel })
  kycLevel: KycLevel;

  @ApiProperty()
  kycHash: string;

  @ApiProperty({ type: TradingLimit })
  tradingLimit: TradingLimit;
}

export class KycChangedWebhookDto extends WebhookDto<KycWebhookData> {
  @ApiProperty({ enum: [WebhookType.KYC_CHANGED] })
  type: WebhookType.KYC_CHANGED;

  @ApiProperty({ type: KycWebhookData })
  data: KycWebhookData;
}

export class KycFailedWebhookDto extends WebhookDto<KycWebhookData> {
  @ApiProperty({ enum: [WebhookType.KYC_FAILED] })
  type: WebhookType.KYC_FAILED;

  @ApiProperty({ type: KycWebhookData })
  data: KycWebhookData;
}
