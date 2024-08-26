import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { BankDataType } from '../bank-data.entity';

export class UpdateBankDataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsEnum(BankDataType)
  type?: BankDataType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  manualCheck?: boolean;
}
