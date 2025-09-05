import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { CheckStatus } from '../../../core/aml/enums/check-status.enum';

export class UpdateTransactionDto {
  @IsOptional()
  @IsString()
  assets: string;

  @IsOptional()
  @IsEnum(CheckStatus)
  amlCheck: CheckStatus;

  @IsOptional()
  @IsBoolean()
  highRisk: boolean;

  @IsOptional()
  @IsNumber()
  amountInChf: number;

  @IsOptional()
  @IsString()
  amlType: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  eventDate: Date;
}
