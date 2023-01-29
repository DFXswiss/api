import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Sell } from '../../../../subdomains/core/sell-crypto/sell/sell.entity';
import { PayoutType } from '../../staking-reward/staking-reward.entity';

export class CreateStakingDto {
  @ApiProperty({ enum: PayoutType })
  @IsNotEmpty()
  @IsEnum([PayoutType.WALLET])
  rewardType: PayoutType;

  @ApiPropertyOptional({ type: EntityDto })
  @ValidateIf((b: CreateStakingDto) => b.rewardType === PayoutType.BANK_ACCOUNT)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  rewardSell?: Sell;

  @ApiPropertyOptional({ type: EntityDto })
  @ValidateIf((b: CreateStakingDto) => b.rewardType === PayoutType.WALLET)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  rewardAsset: Asset;

  @ApiProperty({ enum: PayoutType })
  @IsNotEmpty()
  @IsEnum([PayoutType.WALLET])
  paybackType: PayoutType;

  @ApiPropertyOptional({ type: EntityDto })
  @ValidateIf((b: CreateStakingDto) => b.paybackType === PayoutType.BANK_ACCOUNT)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  paybackSell?: Sell;

  @ApiPropertyOptional({ type: EntityDto })
  @ValidateIf((b: CreateStakingDto) => b.paybackType === PayoutType.WALLET)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  paybackAsset: Asset;
}
