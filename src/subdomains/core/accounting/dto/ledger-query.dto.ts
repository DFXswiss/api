import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

// query DTOs use class-validator + @Type(() => Date) (analog reconciliation.dto.ts)
export class LedgerPeriodQuery {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class LedgerLegsQuery {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}

export class LedgerMarginQuery {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  // string flag (default true; only 'false' disables — analog dashboard-financial.controller.ts dailySample)
  @IsOptional()
  @IsString()
  dailySample?: string;
}

export class LedgerEquityComparisonQuery {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @IsString()
  dailySample?: string;
}
