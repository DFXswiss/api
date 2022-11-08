import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from 'src/subdomains/core/buy-crypto/route/dto/buy-type.enum';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';
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
  minDeposits: MinDeposit[];
}
