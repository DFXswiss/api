import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, ValidateIf } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from '../../buy/dto/buy-type.enum';
import { StakingDto } from '../../staking/dto/staking.dto';

export class CreateCryptoDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(BuyType)
  buyType: BuyType;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateCryptoDto) => b.buyType === BuyType.WALLET)
  @IsNotEmpty()
  @IsObject()
  asset: Asset;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateCryptoDto) => b.buyType === BuyType.STAKING)
  @IsNotEmpty()
  @IsObject()
  staking: StakingDto;

  //Chain
}

