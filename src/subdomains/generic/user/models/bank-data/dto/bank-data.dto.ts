import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class BankDataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  iban: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bic: string;
}
