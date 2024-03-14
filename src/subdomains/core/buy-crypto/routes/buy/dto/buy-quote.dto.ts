import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { TransactionError } from 'src/subdomains/supporting/payment/dto/transaction-error.enum';

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
