import { ApiProperty } from '@nestjs/swagger';

export class BuyQuoteDto {
  @ApiProperty({ description: 'Fee amount in source currency' })
  fee: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;
}
