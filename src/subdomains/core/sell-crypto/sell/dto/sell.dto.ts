import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Deposit } from '../../../../../mix/models/deposit/deposit.entity';
import { MinDeposit } from '../../../../../mix/models/deposit/dto/min-deposit.dto';

export class SellDto {
  id: number;
  active: boolean;
  deposit: Deposit;
  iban: string;
  fiat: Fiat;
  volume: number;
  fee: number;
  isInUse: boolean;
  blockchain: Blockchain;
  minDeposits: MinDeposit[];
}
