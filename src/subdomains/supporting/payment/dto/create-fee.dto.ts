import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { FeeType } from '../entities/fee.entity';

export class CreateFeeDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  label: string;

  @ApiProperty({ enum: FeeType })
  @IsNotEmpty()
  @IsEnum(FeeType)
  type: FeeType;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  rate: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  fixed: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  createDiscountCode = false;

  @ApiPropertyOptional({ enum: AccountType })
  @IsOptional()
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiPropertyOptional({ enum: FeeDirectionType })
  @IsOptional()
  @IsEnum(FeeDirectionType)
  direction: FeeDirectionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiryDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxTxVolume: number; // EUR

  @ApiPropertyOptional()
  @ValidateIf((dto: CreateFeeDto) => dto.type === FeeType.BASE)
  @IsNotEmpty()
  @IsArray()
  assetIds: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxUsages: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxTxUsages: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active = true;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  payoutRefBonus: boolean;
}
