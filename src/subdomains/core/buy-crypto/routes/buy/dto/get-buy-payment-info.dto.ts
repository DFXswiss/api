import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
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
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';

export class GetBuyPaymentInfoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsDfxIban(IbanType.BUY)
  @Transform(Util.trimAll)
  iban?: string;

  @ApiProperty({ type: EntityDto, description: 'Source currency' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;

  @ApiProperty({ type: AssetInDto, description: 'Target asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => AssetInDto)
  asset: Asset;

  @ApiPropertyOptional({ description: 'Amount in source currency' })
  @IsNotEmpty()
  @ValidateIf((b: GetBuyPaymentInfoDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: 'Amount in target asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetBuyPaymentInfoDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  targetAmount: number;

  @IsNotEmpty()
  @IsEnum(FiatPaymentMethod)
  paymentMethod: FiatPaymentMethod = FiatPaymentMethod.BANK;

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
