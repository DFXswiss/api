import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { TransactionError } from 'src/subdomains/supporting/payment/dto/transaction-error.enum';

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

  @ApiProperty({ description: 'Fee dto in source asset' })
  fee: FeeDto;

  @ApiProperty({ description: 'Fee dto in target asset' })
  feeTarget: FeeDto;

  @ApiProperty({ description: 'Minimum volume in source asset' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum Volume in source asset' })
  maxVolume: number;

  @ApiProperty({ description: 'Minimum volume in target currency' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target currency' })
  maxVolumeTarget: number;

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: TransactionError, description: 'Error message in case isValid is false' })
  error?: TransactionError;
}
