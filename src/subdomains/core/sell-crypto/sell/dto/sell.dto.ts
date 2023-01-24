import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Deposit } from '../../../../../mix/models/deposit/deposit.entity';
import { MinDeposit } from '../../../../../mix/models/deposit/dto/min-deposit.dto';

export class SellDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: Deposit })
  deposit: Deposit;

  @ApiProperty()
  iban: string;

  @ApiProperty({ type: Fiat })
  fiat: Fiat;

  @ApiProperty()
  volume: number;

  @ApiProperty()
  fee: number;

  @ApiProperty()
  isInUse: boolean;

  @ApiProperty({ enum: Blockchain })
  blockchain: Blockchain;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
