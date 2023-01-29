import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, ValidateIf, ValidateNested } from 'class-validator';
import { StakingDto } from 'src/mix/models/staking/dto/staking.dto';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { IsDfxIban } from 'src/subdomains/supporting/bank/bank-account/is-dfx-iban.validator';
import { BuyType } from './buy-type.enum';

export class CreateBuyDto {
  @ApiProperty()
  @IsNotEmpty()
  @Transform(Util.trimIban)
  @IsDfxIban()
  iban: string;

  @ApiProperty({ enum: BuyType })
  @IsNotEmpty()
  @IsEnum(BuyType)
  type: BuyType;

  @ApiPropertyOptional({ type: EntityDto })
  @ValidateIf((b: CreateBuyDto) => b.type === BuyType.WALLET)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset?: Asset;

  @ApiPropertyOptional({ type: EntityDto })
  @ValidateIf((b: CreateBuyDto) => b.type === BuyType.STAKING)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  staking?: StakingDto;
}
