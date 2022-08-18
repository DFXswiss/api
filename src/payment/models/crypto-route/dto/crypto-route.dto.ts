import { Blockchain } from 'src/ain/services/crypto.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from '../../buy/dto/buy-type.enum';
import { StakingDto } from '../../staking/dto/staking.dto';

export class CryptoRouteDto {
  id: number;
  active: boolean;
  type: BuyType;
  asset: Asset;
  volume: number;
  annualVolume: number;
  fee: number;
  refBonus: number;
  staking: StakingDto;
  blockchain: Blockchain;
}
