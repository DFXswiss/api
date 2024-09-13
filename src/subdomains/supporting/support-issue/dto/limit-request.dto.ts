import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { FundOrigin, InvestmentDate } from '../entities/limit-request.entity';

export class LimitRequestDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  limit: number;

  @ApiProperty({ enum: InvestmentDate })
  @IsNotEmpty()
  @IsEnum(InvestmentDate)
  investmentDate: InvestmentDate;

  @ApiProperty({ enum: FundOrigin })
  @IsNotEmpty()
  @IsEnum(FundOrigin)
  fundOrigin: FundOrigin;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fundOriginText?: string;
}
