import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsObject, IsOptional, ValidateIf } from 'class-validator';
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
  @IsNotEmpty()
  @IsObject()
  asset: Asset;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateBuyDto) => b.type === BuyType.STAKING)
  @IsNotEmpty()
  @IsObject()
  staking: StakingDto;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  instantPayment: boolean;
}
