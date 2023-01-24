import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { MinDeposit } from '../../../../supporting/address-pool/deposit/dto/min-deposit.dto';

export class SellPaymentInfoDto {
  @ApiProperty()
  fee: number;

  @ApiProperty()
  depositAddress: string;

  @ApiProperty()
  blockchain: Blockchain;

  @ApiProperty({ type: MinDeposit })
  minDeposit: MinDeposit;
}
