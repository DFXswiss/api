import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum WebhookType {
  PAYMENT = 'Payment',
  KYC_CHANGED = 'KycChanged',
  KYC_FAILED = 'KycFailed',
}

export class WebhookDto<T> {
  @ApiProperty({ description: 'User address' })
  id: string;

  @ApiProperty({ enum: WebhookType })
  type: WebhookType;

  @ApiProperty()
  data: T;

  @ApiPropertyOptional()
  reason: string;
}
