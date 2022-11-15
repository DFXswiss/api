import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { InvestmentDate, FundOrigin } from '../limit-request.entity';

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

  @ApiPropertyOptional({ description: 'Base64 encoded file' })
  @IsOptional()
  @IsString()
  documentProof?: string;

  @ApiPropertyOptional({description: 'Name of the proof document'})
  @ValidateIf((l: LimitRequestDto) => l.documentProof != null)
  @IsNotEmpty()
  @IsString()
  documentProofName?: string;
}
