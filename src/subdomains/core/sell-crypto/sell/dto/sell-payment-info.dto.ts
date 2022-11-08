import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { MinDeposit } from '../../../../../mix/models/deposit/dto/min-deposit.dto';

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
