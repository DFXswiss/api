import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNotEmptyObject,
  IsNumber,
  IsOptional,
  IsString,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { XOR } from 'src/shared/validators/xor.validator';

export class GetSellQuoteDto {
  @ApiProperty({ type: EntityDto, description: 'Source asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiPropertyOptional({ description: 'Amount in source asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetSellQuoteDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  amount: number;

  @ApiProperty({ type: EntityDto, description: 'Target currency' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;

  @ApiPropertyOptional({ description: 'Amount in target currency' })
  @IsNotEmpty()
  @ValidateIf((b: GetSellQuoteDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  targetAmount: number;

  @ApiPropertyOptional({ description: 'This field is deprecated, use "specialCode" instead.', deprecated: true })
  @IsOptional()
  @IsString()
  discountCode: string;

  @ApiPropertyOptional({ description: 'Special code' })
  @IsOptional()
  @IsString()
  specialCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wallet: string;
}
