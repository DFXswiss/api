import { ApiProperty } from '@nestjs/swagger';

export class SellQuoteDto {
  @ApiProperty({ description: 'Fee amount in source asset' })
  feeAmount: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Estimated amount in target currency' })
  estimatedAmount: number;
}
