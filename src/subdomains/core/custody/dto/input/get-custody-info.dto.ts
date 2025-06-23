import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsString, Validate, ValidateIf } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { XOR } from 'src/shared/validators/xor.validator';
import { IbanType, IsDfxIban } from 'src/subdomains/supporting/bank/bank-account/is-dfx-iban.validator';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { CustodyOrderType } from '../../enums/custody';

export class GetCustodyInfoDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(CustodyOrderType)
  type: CustodyOrderType;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateIf((b: GetCustodyInfoDto) => Boolean(CustodyOrderType.WITHDRAWAL === b.type))
  @IsString()
  @IsDfxIban(IbanType.SELL)
  @Transform(Util.trimAll)
  @Transform(Util.sanitize)
  iban?: string;

  @ApiProperty({ description: 'Source asset name, Asset or Fiat' })
  @IsNotEmpty()
  @IsString()
  sourceAsset: string;

  @ApiProperty({ description: 'Target asset name, Asset or Fiat' })
  @IsNotEmpty()
  @IsString()
  targetAsset: string;

  @ApiPropertyOptional({ description: 'Amount in source asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetCustodyInfoDto) => Boolean(b.sourceAmount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  sourceAmount: number;

  @ApiPropertyOptional({ description: 'Amount in target asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetCustodyInfoDto) => Boolean(b.targetAmount || !b.sourceAmount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  targetAmount: number;

  @IsNotEmpty()
  @IsEnum(FiatPaymentMethod)
  paymentMethod: FiatPaymentMethod = FiatPaymentMethod.BANK;
}
