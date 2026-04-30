import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetInDto } from 'src/shared/models/asset/dto/asset.dto';

export class CreateSwapDto {
  @ApiProperty({ enum: Blockchain })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty({ type: AssetInDto, deprecated: true, description: 'Use the targetAsset property' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AssetInDto)
  asset: Asset;

  @ApiProperty({ type: AssetInDto })
  @IsNotEmptyObject()
  @ValidateIf((dto: CreateSwapDto) => Boolean(dto.targetAsset || !dto.asset))
  @ValidateNested()
  @Type(() => AssetInDto)
  targetAsset: Asset;
}
