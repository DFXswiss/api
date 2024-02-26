import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { XOR } from 'src/shared/validators/xor.validator';

export class GetCryptoPaymentInfoDto {
  @ApiProperty({ type: EntityDto, description: 'Source asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  sourceAsset: Asset;

  @ApiPropertyOptional({ description: 'Amount in source asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetCryptoPaymentInfoDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  amount: number;

  @ApiProperty({ type: EntityDto, description: 'Target asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  targetAsset: Asset;

  @ApiPropertyOptional({ description: 'Amount in target asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetCryptoPaymentInfoDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  targetAmount: number;

  @ApiPropertyOptional({ description: 'Custom transaction id' })
  @IsOptional()
  @IsString()
  externalTransactionId?: string;

  //eslint-disable-next-line @typescript-eslint/no-inferrable-types
  @ApiPropertyOptional({ description: 'Require an exact price (may take longer)' })
  @IsNotEmpty()
  @IsBoolean()
  exactPrice: boolean = false;
}
