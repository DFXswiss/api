import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';

export class CryptoPaymentInfoDto {
  @ApiProperty()
  fee: number;

  @ApiProperty()
  refBonus: number;

  @ApiProperty()
  depositAddress: string;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
