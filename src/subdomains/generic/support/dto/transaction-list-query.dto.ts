import { IsDateString, IsOptional } from 'class-validator';

export class TransactionListQuery {
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @IsDateString()
  outputFrom?: string;

  @IsOptional()
  @IsDateString()
  outputTo?: string;
}
