import { MinDeposit } from 'src/subdomains/supporting/address-pool/deposit/dto/min-deposit.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from './buy-type.enum';
import { StakingDto } from 'src/subdomains/core/staking/dto/staking.dto';

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
