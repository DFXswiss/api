import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-type.enum';
import { StakingDto } from 'src/subdomains/core/staking/dto/staking.dto';
import { MinDeposit } from '../../../../../supporting/address-pool/deposit/dto/min-deposit.dto';

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
