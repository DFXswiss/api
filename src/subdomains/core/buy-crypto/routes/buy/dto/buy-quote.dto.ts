import { ApiProperty } from '@nestjs/swagger';

export class BuyQuoteDto {
  @ApiProperty({ description: 'Fee amount in source currency' })
  feeAmount: number;

  @ApiProperty({ description: 'Amount in source currency' })
  amount: number;

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Final rate (incl. fees) in source/target' })
  rate: number;
}
