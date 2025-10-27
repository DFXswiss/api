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
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetInDto } from 'src/shared/models/asset/dto/asset.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { XOR } from 'src/shared/validators/xor.validator';
import { IbanType, IsDfxIban } from 'src/subdomains/supporting/bank/bank-account/is-dfx-iban.validator';

export class GetSellPaymentInfoDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsDfxIban(IbanType.SELL)
  @Transform(Util.trimAll)
  iban: string;

  @ApiProperty({ type: AssetInDto, description: 'Source asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => AssetInDto)
  asset: Asset;

  @ApiProperty({ type: EntityDto, description: 'Target currency' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;

  @ApiPropertyOptional({ description: 'Amount in source asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetSellPaymentInfoDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: 'Amount in target currency' })
  @IsOptional()
  @ValidateIf((b: GetSellPaymentInfoDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  targetAmount: number;

  @ApiPropertyOptional({ description: 'Custom transaction id' })
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  externalTransactionId?: string;

  //eslint-disable-next-line @typescript-eslint/no-inferrable-types
  @ApiPropertyOptional({ description: 'Require an exact price (may take longer)' })
  @IsNotEmpty()
  @IsBoolean()
  exactPrice: boolean = false;
}
