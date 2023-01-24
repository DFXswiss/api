import { IsOptional } from 'class-validator';
import { CryptoStaking } from 'src/subdomains/core/staking/entities/crypto-staking.entity';
import { StakingRefReward } from 'src/subdomains/core/staking/entities/staking-ref-reward.entity';
import { StakingReward } from 'src/subdomains/core/staking/entities/staking-reward.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank/bank-tx-repeat/bank-tx-repeat.entity';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';

export class SupportReturnData {
  userData: UserData;
  buyCrypto: BuyCrypto[];
  buyFiat: BuyFiat[];
  ref: BuyCrypto[];
  refReward: RefReward[];
  staking: CryptoStaking[];
  stakingReward: StakingReward[];
  stakingRefReward: StakingRefReward[];
  cryptoInput: CryptoInput[];
  bankTxRepeat: BankTxRepeat[];
}

export class SupportDataQuery {
  @IsOptional()
  userDataId: string;

  @IsOptional()
  userAddress: string;

  @IsOptional()
  depositAddress: string;

  @IsOptional()
  iban: string;

  @IsOptional()
  ref: string;

  @IsOptional()
  bankUsage: string;
}
