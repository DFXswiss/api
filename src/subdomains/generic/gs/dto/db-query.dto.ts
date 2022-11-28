import { IsBoolean, IsDate, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class DbQueryDto {
  @IsNotEmpty()
  @IsString()
  table: string;

  @IsNotEmpty()
  @IsNumber()
  min = 1;

  @IsOptional()
  @IsNumber()
  maxLine: number;

  @IsNotEmpty()
  @IsDate()
  updatedSince: Date = new Date(0);

  @IsNotEmpty()
  @IsBoolean()
  extended = false;

  @IsNotEmpty()
  @IsString()
  sorting: 'ASC' | 'DESC' = 'ASC';

  // Comma separated column names
  @IsOptional()
  select?: string[];

  // Comma separated join names
  @IsNotEmpty()
  join?: [string, string][] = [];

  // Comma separated where clauses
  @IsNotEmpty()
  where?: [string, { [key: string]: string }][] = [];
}
