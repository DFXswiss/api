import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PaymentStandardType {
  OPEN_CRYPTO_PAY = 'OpenCryptoPay',
  LIGHTNING_BOLT11 = 'LightningBolt11',
  PAY_TO_ADDRESS = 'PayToAddress',
}

export class PaymentStandardDto {
  @ApiProperty({ enum: PaymentStandardType })
  id: PaymentStandardType;

  @ApiProperty()
  label: string;

  @ApiProperty()
  description: string;

  @ApiPropertyOptional()
  paymentIdentifierLabel?: string;

  @ApiPropertyOptional()
  blockchain?: string;
}
