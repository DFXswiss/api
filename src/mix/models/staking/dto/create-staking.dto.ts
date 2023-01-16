import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Sell } from '../../../../subdomains/core/sell-crypto/route/sell.entity';
import { PayoutType } from '../../staking-reward/staking-reward.entity';

export class CreateStakingDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum([PayoutType.WALLET])
  rewardType: PayoutType;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.rewardType === PayoutType.BANK_ACCOUNT)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  rewardSell?: Sell;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.rewardType === PayoutType.WALLET)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  rewardAsset: Asset;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum([PayoutType.WALLET])
  paybackType: PayoutType;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.paybackType === PayoutType.BANK_ACCOUNT)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  paybackSell?: Sell;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateStakingDto) => b.paybackType === PayoutType.WALLET)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  paybackAsset: Asset;
}
