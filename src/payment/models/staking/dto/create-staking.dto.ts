import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, IsObject, ValidateIf } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Sell } from '../../sell/sell.entity';
import { PayoutType } from '../../staking-reward/staking-reward.entity';

export class CreateStakingDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(PayoutType)
  rewardType: PayoutType;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.rewardType === PayoutType.BANK_ACCOUNT)
  @IsNotEmptyObject()
  @IsObject()
  rewardSell?: Sell;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.rewardType === PayoutType.WALLET)
  @IsNotEmptyObject()
  @IsObject()
  rewardAsset: Asset;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(PayoutType)
  paybackType: PayoutType;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.paybackType === PayoutType.BANK_ACCOUNT)
  @IsNotEmptyObject()
  @IsObject()
  paybackSell?: Sell;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.paybackType === PayoutType.WALLET)
  @IsNotEmptyObject()
  @IsObject()
  paybackAsset: Asset;
}
