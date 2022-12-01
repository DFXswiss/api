import { MinDeposit } from 'src/mix/models/deposit/dto/min-deposit.dto';
import { StakingDto } from 'src/mix/models/staking/dto/staking.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from './buy-type.enum';

export class BuyDto {
  id: number;
  active: boolean;
  iban: string;
  type: BuyType;
  asset: Asset;
  staking: StakingDto;
  bankUsage: string;
  volume: number;
  annualVolume: number;
  fee: number;
  minDeposits: MinDeposit[];
}
