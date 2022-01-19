import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { Sell } from '../../sell/sell.entity';

export enum StakingType {
  WALLET = 'Wallet',
  SELL = 'Sell',
  REINVEST = 'Reinvest',
}

export class CreateStakingDto {
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
