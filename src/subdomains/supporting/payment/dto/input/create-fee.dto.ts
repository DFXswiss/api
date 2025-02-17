import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { FeeType } from '../../entities/fee.entity';
import { CryptoPaymentMethod, FiatPaymentMethod } from '../payment-method.enum';

export class CreateFeeDto {
  @IsNotEmpty()
  @IsString()
  label: string;

  @IsNotEmpty()
  @IsEnum(FeeType)
  type: FeeType;

  @IsNotEmpty()
  @IsNumber()
  rate: number;

  @IsOptional()
  @IsNumber()
  fixed: number;

  @IsOptional()
  @IsNumber()
  blockchainFactor: number;

  @IsOptional()
  @IsBoolean()
  active = true;

  @IsOptional()
  @IsBoolean()
  payoutRefBonus: boolean;

  // Filter columns
  @IsOptional()
  @IsBoolean()
  createSpecialCode = false;

  @IsOptional()
  @IsEnum(AccountType)
  accountType: AccountType;

  @IsOptional()
  @IsArray()
  paymentMethodsInArray: (FiatPaymentMethod | CryptoPaymentMethod)[];

  @IsOptional()
  @IsArray()
  paymentMethodsOutArray: (FiatPaymentMethod | CryptoPaymentMethod)[];

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiryDate: Date;

  @ValidateIf((dto: CreateFeeDto) => dto.type === FeeType.BASE)
  @IsNotEmpty()
  @IsArray()
  assetIds: number[];

  @IsOptional()
  @IsArray()
  excludedAssetIds: number[];

  @ValidateIf((dto: CreateFeeDto) => dto.type === FeeType.BASE)
  @IsNotEmpty()
  @IsArray()
  fiatIds: number[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  bank: Bank;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  wallet: Wallet;

  // Volume columns
  @IsOptional()
  @IsNumber()
  minTxVolume: number; // EUR

  @IsOptional()
  @IsNumber()
  maxAnnualUserTxVolume: number; // EUR

  @IsOptional()
  @IsNumber()
  maxTxVolume: number; // EUR

  // Acceptance columns
  @IsOptional()
  @IsNumber()
  maxUsages: number;

  @IsOptional()
  @IsNumber()
  maxTxUsages: number;

  @IsOptional()
  @IsNumber()
  maxUserTxUsages: number;
}
