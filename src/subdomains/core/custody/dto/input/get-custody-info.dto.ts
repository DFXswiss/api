import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Validate, ValidateIf } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { XOR } from 'src/shared/validators/xor.validator';
import { IbanType, IsDfxIban } from 'src/subdomains/supporting/bank/bank-account/is-dfx-iban.validator';
import { FiatPaymentMethod, PaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';

export class GetCustodyInfoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsDfxIban(IbanType.BUY) // TODO
  @Transform(Util.trimAll)
  iban?: string;

  @ApiProperty({ description: 'Source asset name, Asset or Fiat' })
  @IsNotEmpty()
  @IsString()
  sourceAsset: string;

  @ApiProperty({ description: 'Target asset name, Asset or Fiat' })
  @IsNotEmpty()
  @IsString()
  targetAsset: string;

  @ApiPropertyOptional({ description: 'Amount in source currency' })
  @IsNotEmpty()
  @ValidateIf((b: GetCustodyInfoDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: 'Amount in target asset' })
  @IsNotEmpty()
  @ValidateIf((b: GetCustodyInfoDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  targetAmount: number;

  @IsNotEmpty()
  @IsEnum(FiatPaymentMethod)
  paymentMethod: PaymentMethod = FiatPaymentMethod.BANK;
}
