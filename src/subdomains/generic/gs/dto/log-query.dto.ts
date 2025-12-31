import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LogQueryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(10000)
  kql: string;

  @IsOptional()
  @IsString()
  timespan?: string; // ISO 8601 duration, e.g., PT1H, P1D
}

export class LogQueryResult {
  columns: { name: string; type: string }[];
  rows: any[][];
}
