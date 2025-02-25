import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/transaction-helper/min-amount.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';

export class BeneficiaryDto {
  @ApiProperty()
  iban: string;

  @ApiPropertyOptional()
  name?: string;
}

export class SellPaymentInfoDto {
  @ApiProperty({ description: 'Transaction order ID' })
  id: number;

  @ApiProperty({ description: 'UID of the transaction order' })
  uid?: string;

  @ApiProperty({ description: 'Price timestamp' })
  timestamp: Date;

  @ApiProperty()
  routeId: number;

  @ApiPropertyOptional()
  depositAddress?: string;

  @ApiProperty({ deprecated: true })
  blockchain: Blockchain;

  @ApiProperty({ type: MinAmount, deprecated: true })
  minDeposit: MinAmount;

  @ApiProperty({ description: 'Fee in percentage', deprecated: true })
  fee: number;

  @ApiProperty({ description: 'Minimum fee in source asset', deprecated: true })
  minFee: number;

  @ApiProperty({ type: FeeDto, description: 'Fee infos in source asset' })
  fees: FeeDto;

  @ApiProperty({ description: 'Minimum volume in source asset' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum Volume in source asset' })
  maxVolume: number;

  @ApiProperty({ description: 'Amount in source asset' })
  amount: number;

  @ApiProperty({ type: AssetDto, description: 'Source asset' })
  asset: AssetDto;

  @ApiProperty({ description: 'Minimum fee in target currency', deprecated: true })
  minFeeTarget: number;

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

  @ApiProperty({ description: 'Exact or approximate price' })
  exactPrice: boolean;

  @ApiProperty({ type: PriceStep, isArray: true })
  priceSteps: PriceStep[];

  @ApiProperty({ description: 'Estimated amount in target currency' })
  estimatedAmount: number;

  @ApiProperty({ type: FiatDto, description: 'Target currency' })
  currency: FiatDto;

  @ApiProperty({ type: BeneficiaryDto, description: 'Bank transaction beneficiary' })
  beneficiary: BeneficiaryDto;

  @ApiPropertyOptional({ description: 'Payment request (e.g. Lightning invoice)' })
  paymentRequest?: string;

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error message in case isValid is false' })
  error?: QuoteError;
}
