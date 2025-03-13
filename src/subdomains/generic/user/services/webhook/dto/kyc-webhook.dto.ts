import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
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
  @ApiPropertyOptional()
  mail: string;

  @ApiPropertyOptional()
  firstName: string;

  @ApiPropertyOptional()
  lastName: string;

  @ApiPropertyOptional()
  street: string;

  @ApiPropertyOptional()
  houseNumber: string;

  @ApiPropertyOptional()
  city: string;

  @ApiPropertyOptional()
  zip: string;

  @ApiPropertyOptional({ type: CountryDto })
  country: CountryDto;

  @ApiPropertyOptional({ type: CountryDto })
  nationality: CountryDto;

  @ApiPropertyOptional()
  birthday: Date;

  @ApiPropertyOptional()
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
  type = WebhookType.KYC_CHANGED;

  @ApiProperty({ type: KycWebhookData })
  declare data: KycWebhookData;
}

export class KycFailedWebhookDto extends WebhookDto<KycWebhookData> {
  @ApiProperty({ enum: [WebhookType.KYC_FAILED] })
  type = WebhookType.KYC_FAILED;

  @ApiProperty({ type: KycWebhookData })
  declare data: KycWebhookData;
}
