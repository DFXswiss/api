import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { Eip7702AuthorizationDataDto } from 'src/subdomains/core/sell-crypto/route/dto/gasless-transfer.dto';
import { UnsignedTxDto } from 'src/subdomains/core/sell-crypto/route/dto/unsigned-tx.dto';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/transaction-helper/min-amount.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';

export class SwapPaymentInfoDto {
  @ApiProperty({ description: 'Transaction order ID' })
  id: number;

  @ApiProperty({ description: 'UID of the transaction order' })
  uid?: string;

  @ApiProperty({ description: 'Price timestamp' })
  timestamp: Date;

  @ApiProperty()
  routeId: number;

  @ApiPropertyOptional()
  depositAddress: string;

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

  @ApiProperty({ description: 'Maximum volume in source asset' })
  maxVolume: number;

  @ApiProperty({ description: 'Amount in source asset' })
  amount: number;

  @ApiProperty({ type: AssetDto, description: 'Source asset' })
  sourceAsset: AssetDto;

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
  targetAsset: AssetDto;

  @ApiPropertyOptional({ description: 'Payment request (e.g. Lightning invoice)' })
  paymentRequest?: string;

  @ApiPropertyOptional({ type: UnsignedTxDto, description: 'Unsigned transaction data for EVM chains' })
  depositTx?: UnsignedTxDto;

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error message in case isValid is false' })
  error?: QuoteError;

  @ApiPropertyOptional({
    type: Eip7702AuthorizationDataDto,
    description: 'EIP-7702 authorization data for gasless transactions (user has 0 native balance)',
  })
  eip7702Authorization?: Eip7702AuthorizationDataDto;

  @ApiPropertyOptional({
    description: 'Whether gasless transaction is available for this request',
  })
  gaslessAvailable?: boolean;
}
