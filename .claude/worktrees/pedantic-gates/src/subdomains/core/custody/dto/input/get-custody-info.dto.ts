import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsString, Validate, ValidateIf } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
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

  @ApiPropertyOptional({ description: 'Target address' })
  @IsNotEmpty()
  @ValidateIf((b: GetCustodyInfoDto) => Boolean(CustodyOrderType.SEND === b.type))
  @IsString()
  targetAddress: string;

  @ApiPropertyOptional({ description: 'Target blockchain' })
  @IsNotEmpty()
  @ValidateIf((b: GetCustodyInfoDto) => Boolean(CustodyOrderType.SEND === b.type))
  @IsEnum(Blockchain)
  targetBlockchain: Blockchain;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @ValidateIf((b: GetCustodyInfoDto) => Boolean(CustodyOrderType.WITHDRAWAL === b.type))
  @IsString()
  @IsDfxIban(IbanType.SELL)
  @Transform(Util.trimAll)
  targetIban?: string;

  @IsNotEmpty()
  @IsEnum(FiatPaymentMethod)
  paymentMethod: FiatPaymentMethod = FiatPaymentMethod.BANK;
}
