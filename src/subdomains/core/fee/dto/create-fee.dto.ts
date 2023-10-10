import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { FeeDirectionType } from 'src/subdomains/generic/user/models/user/user.entity';
import { FeeType } from '../fee.entity';

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
  value: number;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  createDiscountCode = false;

  @ApiProperty({ enum: AccountType })
  @IsOptional()
  @IsEnum(AccountType)
  accountType: AccountType;

  @ApiProperty({ enum: FeeDirectionType })
  @IsOptional()
  @IsEnum(FeeDirectionType)
  direction: FeeDirectionType;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiryDate: Date;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  maxTxVolume: number; // EUR

  @ApiProperty()
  @IsOptional()
  @IsArray()
  assetIds: string[];

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  maxUsages: number;
}
