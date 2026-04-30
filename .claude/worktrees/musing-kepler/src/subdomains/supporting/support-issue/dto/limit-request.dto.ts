import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
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
  @Transform(Util.sanitize)
  fundOriginText?: string;
}
