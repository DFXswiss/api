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
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { FeeType } from '../entities/fee.entity';

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
  @IsBoolean()
  createDiscountCode = false;

  @IsOptional()
  @IsEnum(AccountType)
  accountType: AccountType;

  @IsOptional()
  @IsEnum(FeeDirectionType)
  direction: FeeDirectionType;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiryDate: Date;

  @IsOptional()
  @IsNumber()
  minTxVolume: number; // EUR

  @IsOptional()
  @IsNumber()
  maxTxVolume: number; // EUR

  @ValidateIf((dto: CreateFeeDto) => dto.type === FeeType.BASE)
  @IsNotEmpty()
  @IsArray()
  assetIds: number[];

  @IsOptional()
  @IsNumber()
  maxUsages: number;

  @IsOptional()
  @IsNumber()
  maxTxUsages: number;

  @IsOptional()
  @IsBoolean()
  active = true;

  @IsOptional()
  @IsBoolean()
  payoutRefBonus: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  wallet: Wallet;
}
