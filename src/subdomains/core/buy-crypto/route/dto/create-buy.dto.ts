import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, ValidateIf, ValidateNested } from 'class-validator';
import { StakingDto } from 'src/mix/models/staking/dto/staking.dto';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from './buy-type.enum';

export class CreateBuyDto {
  @ApiProperty()
  @IsNotEmpty()
  // @IsIBAN()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(BuyType)
  type: BuyType;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateBuyDto) => b.type === BuyType.WALLET)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset?: Asset;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateBuyDto) => b.type === BuyType.STAKING)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  staking?: StakingDto;
}
