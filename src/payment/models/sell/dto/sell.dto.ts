import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Deposit } from '../../deposit/deposit.entity';

export class SellDto {
  id: number;
  active: boolean;
  deposit: Deposit;
  iban: string;
  fiat: Fiat;
  volume: number;
  fee: number;
  isInUse: boolean;
}
