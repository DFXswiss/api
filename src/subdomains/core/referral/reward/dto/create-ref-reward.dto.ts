import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { RewardStatus } from '../ref-reward.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class CreateRefRewardDto {
  @IsNotEmpty()
  @IsNumber()
  outputAmount: number;

  @IsNotEmpty()
  @IsString()
  outputAsset: string;

  @IsNotEmpty()
  @IsInt()
  userId: number;

  @IsNotEmpty()
  @IsEnum(RewardStatus)
  status: RewardStatus;

  @IsNotEmpty()
  @IsString()
  targetAddress: string;

  @IsNotEmpty()
  @IsEnum(Blockchain)
  targetBlockchain: Blockchain;

  @IsNotEmpty()
  @IsNumber()
  amountInChf: number;

  @IsNotEmpty()
  @IsNumber()
  amountInEur: number;
}
