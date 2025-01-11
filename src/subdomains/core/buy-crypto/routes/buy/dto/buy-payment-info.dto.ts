import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/transaction-helper/min-amount.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';

export class BankInfoDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  bank: string;

  @ApiProperty()
  street: string;

  @ApiProperty()
  number: string;

  @ApiProperty()
  zip: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  country: string;

  @ApiPropertyOptional()
  iban: string;

  @ApiProperty()
  bic: string;

  @ApiProperty()
  sepaInstant: boolean;
}

export class BuyPaymentInfoDto extends BankInfoDto {
  @ApiProperty({ description: 'Transaction request ID' })
  id: number;

  @ApiProperty({ description: 'Price timestamp' })
  timestamp: Date;

  @ApiProperty()
  routeId: number;

  @ApiPropertyOptional()
  remittanceInfo: string;

  @ApiProperty({ type: MinAmount, deprecated: true })
  minDeposit: MinAmount;

  @ApiProperty({ description: 'Fee in percentage', deprecated: true })
  fee: number;

  @ApiProperty({ description: 'Minimum fee in source currency', deprecated: true })
  minFee: number;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in source currency' })
  fees: FeeDto;

  @ApiProperty({ description: 'Minimum volume in source currency' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum volume in source currency' })
  maxVolume: number;

  @ApiProperty({ description: 'Amount in source currency' })
  amount: number;

  @ApiProperty({ type: FiatDto, description: 'Source currency' })
  currency: FiatDto;

  @ApiProperty({ description: 'Minimum fee in target asset', deprecated: true })
  minFeeTarget: number;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in target asset' })
  feesTarget: FeeDto;

  @ApiProperty({ description: 'Minimum volume in target asset' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target asset' })
  maxVolumeTarget: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Final rate (incl. fees) in source/target' })
  rate: number;

  @ApiProperty({ description: 'Exact or approximate price' })
  exactPrice: boolean;

  @ApiProperty({ type: PriceStep, isArray: true })
  priceSteps: PriceStep[];

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;

  @ApiProperty({ type: AssetDto, description: 'Target asset' })
  asset: AssetDto;

  @ApiPropertyOptional({ description: 'Payment request (e.g. GiroCode content)' })
  paymentRequest?: string;

  @ApiProperty({ description: 'UID of the transaction request' })
  transactionRequestUid?: string;

  paymentLink?: string;
  nameRequired?: boolean;

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error message in case isValid is false' })
  error?: QuoteError;
}
