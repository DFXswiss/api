import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';

export class BuyQuoteDto {
  @ApiProperty({ description: 'Fee amount in source currency', deprecated: true })
  feeAmount: number;

  @ApiProperty({ description: 'Amount in source currency' })
  amount: number;

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Final rate (incl. fees) in source/target' })
  rate: number;

  @ApiProperty({ description: 'Minimum volume in source currency' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum volume in source currency' })
  maxVolume: number;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in source currency' })
  fees: FeeDto;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in target asset' })
  feesTarget: FeeDto;

  @ApiProperty({ description: 'Minimum volume in target asset' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target asset' })
  maxVolumeTarget: number;

  @ApiProperty({ type: PriceStep, isArray: true })
  priceSteps: PriceStep[];

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error message in case isValid is false' })
  error?: QuoteError;
}
