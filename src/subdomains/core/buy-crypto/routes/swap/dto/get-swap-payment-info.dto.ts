import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetInDto } from 'src/shared/models/asset/dto/asset.dto';
import { Util } from 'src/shared/utils/util';
import { XOR } from 'src/shared/validators/xor.validator';

export class GetSwapPaymentInfoDto {
  @ApiProperty({ type: AssetInDto, description: 'Source asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => AssetInDto)
  sourceAsset: Asset;

  @ApiPropertyOptional({ description: 'Amount in source asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetSwapPaymentInfoDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  amount: number;

  @ApiProperty({ type: AssetInDto, description: 'Target asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => AssetInDto)
  targetAsset: Asset;

  @ApiPropertyOptional({ description: 'Amount in target asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetSwapPaymentInfoDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  targetAmount: number;

  @ApiPropertyOptional({ description: 'Custom transaction id' })
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  externalTransactionId?: string;

  @ApiPropertyOptional({ description: 'Require an exact price (may take longer)' })
  @IsNotEmpty()
  @IsBoolean()
  exactPrice: boolean = false;
}
