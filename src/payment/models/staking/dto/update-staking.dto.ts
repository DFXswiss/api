import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { Sell } from '../../sell/sell.entity';
import { StakingType } from './staking-type.enum';

export class UpdateStakingDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  active: boolean;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(StakingType)
  rewardType: StakingType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  rewardSell?: Sell;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(StakingType)
  paybackType: StakingType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  paybackSell?: Sell;
}
