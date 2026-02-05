import { IsOptional, IsString } from 'class-validator';

export class TransactionListQuery {
  @IsOptional()
  @IsString()
  createdFrom?: string;

  @IsOptional()
  @IsString()
  createdTo?: string;

  @IsOptional()
  @IsString()
  outputFrom?: string;

  @IsOptional()
  @IsString()
  outputTo?: string;
}
