import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/min-amount.dto';
import { TransactionError } from 'src/subdomains/supporting/payment/services/transaction-helper';

export class CryptoPaymentInfoDto {
  @ApiProperty()
  routeId: number;

  @ApiProperty()
  depositAddress: string;

  @ApiProperty()
  blockchain: Blockchain;

  @ApiProperty({ type: MinAmount, deprecated: true })
  minDeposit: MinAmount;

  @ApiProperty({ description: 'Fee in percentage' })
  fee: number;

  @ApiProperty({ description: 'Minimum fee in source asset' })
  minFee: number;

  @ApiProperty({ description: 'Minimum volume in source asset' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum volume in source asset' })
  maxVolume: number;

  @ApiProperty({ description: 'Amount in source asset' })
  amount: number;

  @ApiProperty({ type: AssetDto, description: 'Source asset' })
  sourceAsset: AssetDto;

  @ApiProperty({ description: 'Minimum fee in target asset' })
  minFeeTarget: number;

  @ApiProperty({ description: 'Minimum volume in target asset' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target asset' })
  maxVolumeTarget: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Rate in sourceAmount/targetAmount' })
  rate: number;

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;

  @ApiProperty({ type: AssetDto, description: 'Target asset' })
  targetAsset: AssetDto;

  @ApiPropertyOptional({ description: 'Payment request (e.g. Lightning invoice)' })
  paymentRequest?: string;

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: TransactionError, description: 'Error message in case isValid is false' })
  error?: TransactionError;
}
