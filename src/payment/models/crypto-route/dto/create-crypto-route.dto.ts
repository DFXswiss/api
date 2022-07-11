import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from '../../buy/dto/buy-type.enum';
import { Blockchain } from '../../deposit/deposit.entity';
import { StakingDto } from '../../staking/dto/staking.dto';

export class CreateCryptoRouteDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(BuyType)
  buyType: BuyType;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateCryptoRouteDto) => b.buyType === BuyType.WALLET)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateCryptoRouteDto) => b.buyType === BuyType.STAKING)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  targetDeposit: StakingDto;
}
