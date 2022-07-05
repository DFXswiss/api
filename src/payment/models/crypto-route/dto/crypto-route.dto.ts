import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from '../../buy/dto/buy-type.enum';
import { StakingDto } from '../../staking/dto/staking.dto';

export class CryptoDto {
  id: number;
  active: boolean;
  buyType: BuyType;
  asset: Asset;
  volume: number;
  annualVolume: number;
  fee: number;
  staking: StakingDto;
}
