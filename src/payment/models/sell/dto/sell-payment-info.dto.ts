import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';

export class SellPaymentInfoDto {
  @ApiProperty()
  fee: number;

  @ApiProperty()
  depositAddress: string;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
