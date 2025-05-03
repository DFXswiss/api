import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BeneficiaryDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';

export class CustodyOrderResponseDto {
  @ApiProperty({ description: 'Transaction order ID' })
  id: number;

  @ApiProperty({ description: 'UID of the transaction order' })
  uid?: string;

  @ApiProperty({ description: 'Price timestamp' })
  timestamp: Date;

  @ApiPropertyOptional()
  remittanceInfo?: string;

  @ApiProperty({ description: 'Minimum volume in source asset' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum Volume in source asset' })
  maxVolume: number;

  @ApiProperty({ description: 'Amount in source asset' })
  amount: number;

  @ApiProperty({ description: 'Source asset name, Asset or Fiat' })
  sourceAsset: string;

  @ApiProperty({ description: 'Target asset name, Asset or Fiat' })
  targetAsset: string;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in source asset' })
  fees: FeeDto;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in target currency' })
  feesTarget: FeeDto;

  @ApiProperty({ description: 'Minimum volume in target currency' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target currency' })
  maxVolumeTarget: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Final rate (incl. fees) in source/target' })
  rate: number;

  @ApiProperty({ type: PriceStep, isArray: true })
  priceSteps: PriceStep[];

  @ApiProperty({ description: 'Estimated amount in target currency' })
  estimatedAmount: number;

  @ApiPropertyOptional({ description: 'Payment request (e.g. Lightning invoice)' })
  paymentRequest?: string;

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error message in case isValid is false' })
  error?: QuoteError;

  // Sell
  @ApiPropertyOptional({ type: BeneficiaryDto, description: 'Bank transaction beneficiary' })
  beneficiary?: BeneficiaryDto;

  // Buy
  paymentLink?: string;

  // Buy
  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  bank?: string;

  @ApiPropertyOptional()
  street?: string;

  @ApiPropertyOptional()
  number?: string;

  @ApiPropertyOptional()
  zip?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  country?: string;

  @ApiPropertyOptional()
  iban?: string;

  @ApiPropertyOptional()
  bic?: string;

  @ApiPropertyOptional()
  sepaInstant?: boolean;
}
