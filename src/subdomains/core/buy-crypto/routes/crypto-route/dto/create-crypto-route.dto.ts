import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, ValidateIf, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BuyType } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-type.enum';
import { StakingDto } from 'src/subdomains/core/staking/dto/staking.dto';

export class CreateCryptoRouteDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(BuyType)
  type: BuyType;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateCryptoRouteDto) => b.type === BuyType.WALLET)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiPropertyOptional()
  @ValidateIf((b: CreateCryptoRouteDto) => b.type === BuyType.STAKING)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  staking?: StakingDto;
}
