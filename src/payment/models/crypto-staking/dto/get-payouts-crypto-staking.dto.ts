import { IsEnum, IsInt, IsNumber, IsString } from 'class-validator';
import { PayoutType } from '../../staking-reward/staking-reward.entity';

export class GetPayoutsCryptoStakingDto {
  @IsInt()
  id: number;

  @IsString()
  address: string;

  @IsNumber()
  amount: number;

  @IsEnum(PayoutType)
  payoutType: PayoutType;

  @IsString()
  outputAsset: string;
}
