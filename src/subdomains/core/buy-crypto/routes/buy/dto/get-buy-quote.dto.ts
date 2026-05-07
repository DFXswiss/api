import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetInDto } from 'src/shared/models/asset/dto/asset.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatInDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { XOR } from 'src/shared/validators/xor.validator';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';

export class GetBuyQuoteDto {
  @ApiProperty({ type: FiatInDto, description: 'Source currency (by ID or name)' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => FiatInDto)
  currency: Fiat;

  @ApiProperty({ type: AssetInDto, description: 'Target asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => AssetInDto)
  asset: Asset;

  @ApiPropertyOptional({ description: 'Amount in source currency' })
  @IsNotEmpty()
  @ValidateIf((b: GetBuyQuoteDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: 'Amount in target asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetBuyQuoteDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  targetAmount: number;

  @ApiPropertyOptional({ description: 'Payment method', enum: FiatPaymentMethod })
  @IsNotEmpty()
  @IsEnum(FiatPaymentMethod)
  paymentMethod: FiatPaymentMethod = FiatPaymentMethod.BANK;

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

  @ApiPropertyOptional({ description: 'Country code (ISO 3166-1 alpha-2, e.g. DE, CH, US)' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'State or province code (e.g. US-NY, CA-BC)' })
  @IsOptional()
  @IsString()
  stateProvince?: string;
}
