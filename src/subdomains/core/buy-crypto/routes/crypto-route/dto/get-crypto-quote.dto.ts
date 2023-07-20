import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNotEmptyObject, IsNumber, IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';

export class GetCryptoQuoteDto {
  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  sourceAsset: Asset;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiProperty({ type: EntityDto, deprecated: true, description: 'Use the targetAsset property' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateIf((dto: GetCryptoQuoteDto) => Boolean(dto.targetAsset || !dto.asset))
  @ValidateNested()
  @Type(() => EntityDto)
  targetAsset: Asset;
}
