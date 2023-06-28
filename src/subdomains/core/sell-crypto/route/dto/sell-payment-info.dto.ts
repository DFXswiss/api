import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';

export class SellPaymentInfoDto {
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

  @ApiProperty({ description: 'Minimum fee in target currency' })
  minFeeTarget: number;

  @ApiProperty({ description: 'Minimum volume in target currency' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Estimated amount in target currency' })
  estimatedAmount: number;

  @ApiPropertyOptional({ description: 'Payment request (e.g. Lightning invoice)' })
  paymentRequest?: string;
}
