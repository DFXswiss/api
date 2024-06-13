import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';

export class SellQuoteDto {
  @ApiProperty({ description: 'Fee amount in source asset', deprecated: true })
  feeAmount: number;

  @ApiProperty({ description: 'Amount in source asset' })
  amount: number;

  @ApiProperty({ description: 'Estimated amount in target currency' })
  estimatedAmount: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Final rate (incl. fees) in source/target' })
  rate: number;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in source asset' })
  fees: FeeDto;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in target currency' })
  feesTarget: FeeDto;

  @ApiProperty({ description: 'Minimum volume in source asset' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum Volume in source asset' })
  maxVolume: number;

  @ApiProperty({ description: 'Minimum volume in target currency' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target currency' })
  maxVolumeTarget: number;

  @ApiProperty({ type: PriceStep, isArray: true })
  priceSteps: PriceStep[];

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error message in case isValid is false' })
  error?: QuoteError;
}
