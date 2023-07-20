import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNotEmptyObject, IsNumber, IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';

export class GetCryptoPaymentInfoDto {
  @ApiProperty({ type: EntityDto, description: 'Source asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  sourceAsset: Asset;

  //eslint-disable-next-line @typescript-eslint/no-inferrable-types
  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number = 0;

  @ApiProperty({ type: EntityDto, deprecated: true, description: 'Use the targetAsset property' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiProperty({ type: EntityDto, description: 'Target asset' })
  @IsNotEmptyObject()
  @ValidateIf((dto: GetCryptoPaymentInfoDto) => Boolean(dto.targetAsset || !dto.asset))
  @ValidateNested()
  @Type(() => EntityDto)
  targetAsset: Asset;
}
