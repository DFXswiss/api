import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';

export class CreateSwapDto {
  @ApiProperty({ enum: Blockchain })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty({ type: EntityDto, deprecated: true, description: 'Use the targetAsset property' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateIf((dto: CreateSwapDto) => Boolean(dto.targetAsset || !dto.asset))
  @ValidateNested()
  @Type(() => EntityDto)
  targetAsset: Asset;
}
