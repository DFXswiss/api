import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, ValidateIf } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Sell } from '../../sell/sell.entity';
import { StakingType } from './staking-type.enum';

export class CreateStakingDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(StakingType)
  rewardType: StakingType;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.rewardType === StakingType.BANK_ACCOUNT)
  @IsNotEmpty()
  @IsObject()
  rewardSell?: Sell;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.rewardType === StakingType.WALLET)
  @IsNotEmpty()
  @IsObject()
  rewardAsset: Asset;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(StakingType)
  paybackType: StakingType;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.paybackType === StakingType.BANK_ACCOUNT)
  @IsNotEmpty()
  @IsObject()
  paybackSell?: Sell;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.paybackType === StakingType.WALLET)
  @IsNotEmpty()
  @IsObject()
  paybackAsset: Asset;
}
