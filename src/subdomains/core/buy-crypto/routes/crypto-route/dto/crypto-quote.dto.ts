import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { TransactionError } from 'src/subdomains/supporting/payment/dto/transaction-error.enum';

export class CryptoQuoteDto {
  @ApiProperty({ description: 'Fee amount in source asset', deprecated: true })
  feeAmount: number;

  @ApiProperty({ description: 'Amount in source asset' })
  amount: number;

  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;

  @ApiProperty({ description: 'Minimum volume in source asset' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum volume in source asset' })
  maxVolume: number;

  @ApiProperty({ description: 'Fee dto in source asset' })
  fee: FeeDto;

  @ApiProperty({ description: 'Fee dto in target asset' })
  feeTarget: FeeDto;

  @ApiProperty({ description: 'Minimum volume in target asset' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target asset' })
  maxVolumeTarget: number;

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: TransactionError, description: 'Error message in case isValid is false' })
  error?: TransactionError;
}
