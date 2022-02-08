import { Asset } from 'src/shared/models/asset/asset.entity';
import { StakingDto } from '../../staking/dto/staking.dto';
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
  refBonus: number;
}
