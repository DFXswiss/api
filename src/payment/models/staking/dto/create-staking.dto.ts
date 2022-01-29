import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Sell } from '../../sell/sell.entity';
import { StakingType } from './staking-type.enum';

export class CreateStakingDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(StakingType)
  rewardType: StakingType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  rewardSell?: Sell;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  rewardAsset: Asset;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(StakingType)
  paybackType: StakingType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  paybackSell?: Sell;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  paybackAsset: Asset;
}
