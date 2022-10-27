import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';

export class SellPaymentInfoDto {
  @ApiProperty()
  fee: number;

  @ApiProperty()
  depositAddress: string;

  @ApiProperty()
  blockchain: Blockchain;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
