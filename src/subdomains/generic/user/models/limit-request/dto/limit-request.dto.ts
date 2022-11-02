import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { InvestmentDate, FundOrigin } from '../limit-request.entity';

export class LimitRequestDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  limit: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(InvestmentDate)
  investmentDate: InvestmentDate;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(FundOrigin)
  fundOrigin: FundOrigin;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fundOriginText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentProof?: string;

  @ApiPropertyOptional()
  @ValidateIf((l: LimitRequestDto) => l.documentProof != null)
  @IsNotEmpty()
  @IsString()
  documentProofName?: string;
}
