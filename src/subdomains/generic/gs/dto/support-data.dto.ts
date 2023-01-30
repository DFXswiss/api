import { IsOptional } from 'class-validator';
import { CryptoInput } from 'src/mix/models/crypto-input/crypto-input.entity';
import { CryptoStaking } from 'src/mix/models/crypto-staking/crypto-staking.entity';
import { StakingRefReward } from 'src/mix/models/staking-ref-reward/staking-ref-reward.entity';
import { StakingReward } from 'src/mix/models/staking-reward/staking-reward.entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/buy-fiat/buy-fiat.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank/bank-tx-repeat/bank-tx-repeat.entity';
import { UserData } from '../../user/models/user-data/user-data.entity';

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

  @IsOptional()
  kycFileId: number;

  @IsOptional()
  mail: string;

  @IsOptional()
  kycCustomerId: number;

  @IsOptional()
  kycHash: string;

  @IsOptional()
  buyCryptoId: number;

  @IsOptional()
  buyCryptoTxId: string;

  @IsOptional()
  bankTxId: number;

  @IsOptional()
  bankTxEndToEndId: string;

  @IsOptional()
  bankTxInstructionId: string;

  @IsOptional()
  bankTxRemittanceInfo: string;

  @IsOptional()
  cryptoInputId: number;

  @IsOptional()
  cryptoInputInTxId: string;

  @IsOptional()
  cryptoInputOutTxId: string;

  @IsOptional()
  fiatOutputId: number;

  @IsOptional()
  buyFiatId: number;
}
