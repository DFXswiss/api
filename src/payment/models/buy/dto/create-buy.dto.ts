import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, IsObject, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { StakingDto } from '../../staking/dto/staking.dto';
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
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateBuyDto) => b.type === BuyType.STAKING)
  @IsNotEmptyObject()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  staking: StakingDto;
}
